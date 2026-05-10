# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project overview

note-distill is a Claude Code plugin that forks a background subagent to distill technical discussions into structured notes. It supports multiple knowledge base targets (adapters) and note styles; v0.0.1 ships the Obsidian adapter. Invoked via `/note [quick|deep] [--style <style>] [topic]`. All files are Markdown or JSON — no build step, linter, or test framework.

## Architecture

```
/note → commands/note.md (argument parsing, including --style)
      → skills/note-distill/SKILL.md (reads config, resolves MODE+STYLE, spawns fork subagent)
        → fork subagent (background):
          1. note-writer-protocol.md → workflow
          2. styles/<style>.md → writing philosophy + template overrides
          3. {quick,depth}-template.md → content structure
          4. adapters/<name>.md → target-specific write conventions
          5. writes note to knowledge base, reports path via SendMessage
```

Plugin manifest: `.claude-plugin/plugin.json`

**Zero-summarization rule**: The main agent only parses args, reads config, and spawns. The subagent inherits full conversation context via fork and does all work independently.

## Installation & activation

Install via Claude Code's built-in plugin manager. Claude Code auto-discovers `commands/` and `skills/` from the installed plugin directory — no manual symlinks or `mkdir`.

```bash
# From GitHub (end users)
/plugin install github.com/konanok/note-distill

# From local path (development)
/plugin install ~/Projects/Github/note-distill
```

Changes to project files take effect immediately — no restart needed (except for SKILL.md frontmatter `name`/`description` field changes).

## Key conventions

- **`{SKILL_DIR}`**: Path placeholder in SKILL.md for internal references. Derived from the Skill tool's "Base directory for this skill" output when the skill is loaded — NOT from filesystem computation. Injected by main agent into the subagent spawn prompt. Never hardcode skill paths — the plugin may be installed elsewhere.
- **`fast`/`f`** are aliases for `quick` — normalize before passing to subagent.
- **`--style <name>`**: Supported values: `technical` (default), `til`, `evergreen`. Style files live in `styles/`. Style overrides template structure and frontmatter.
- **Style cross-cutting rules**: A style file can override more than just the template — it can force a specific mode (e.g., `til` forces `quick`, `evergreen` forces `deep`) and override the adapter's default output directory (e.g., `til` → `TIL/`, `evergreen` → `Evergreen/`). When reading a style file, always check for all three overrides: template structure, mode, and output path.
- **User config** at `~/.config/note-distill/config.json` (not in plugin tree). Example template: `skills/note-distill/config.example.json`. `.gitignore` excludes `**/note-distill/config.json`.
- **Adapters**: One file per output target under `adapters/`. Templates and protocol are target-agnostic. To add Notion/Feishu: new adapter file + new `adapter` value in config + config fields for that target.
- **All `.md` files use LF line endings**.
- **Config fields**: when adding a new config field, update both `config.example.json` and (if present locally) `docs/DESIGN.md` §4.1.
- **`docs/` is gitignored**: design docs and ADRs are local-only, not part of the distributed plugin.

## Where to change what

| Task | File |
|---|---|
| Main flow / spawn logic | `skills/note-distill/SKILL.md` |
| Subagent workflow / identification / verification rules | `skills/note-distill/references/note-writer-protocol.md` |
| Note templates (quick/deep) | `skills/note-distill/references/{quick,depth}-template.md` |
| Note style (writing philosophy + template overrides) | `skills/note-distill/styles/<style>.md` |
| Obsidian write conventions | `skills/note-distill/adapters/obsidian.md` |
| Add a new output target (Notion/Feishu) | New `skills/note-distill/adapters/<name>.md` + new `adapter` value in config |
| Command argument parsing / aliases | `commands/note.md` + SKILL.md Step 2 |

## Directory responsibility (single-responsibility)

| Directory / file | Responsibility | Must NOT contain |
|---|---|---|
| `skills/note-distill/SKILL.md` | Main agent flow + spawn prompt template | Subagent execution logic |
| `references/note-writer-protocol.md` | Subagent behavior spec (identification, verification, reporting) | Note formatting |
| `references/{quick,depth}-template.md` | Note structure template + anti-patterns | Write logic |
| `styles/<style>.md` | Writing philosophy + template overrides for a specific style | Platform write logic |
| `adapters/<name>.md` | Platform-specific write conventions (frontmatter, filename, API) | Content organization rules |
| `commands/note.md` | Parse command args + delegate to skill | Any business logic |

## Testing

Manual verification:

1. `/note quick` → short note written to configured target
2. `/note deep` → full note with TL;DR, wikilinks, verification evidence
3. `/note` (no args) → auto mode
4. `/note --style til` → TIL-format note in `{vault}/TIL/`, frontmatter has `status: seed`
5. `/note deep --style evergreen` → evergreen note with proposition-sentence title, 5+ wikilinks
6. Frontmatter includes tags, source, mode, created, aliases
7. Subagent reports path on completion via SendMessage

## Release

1. Update `CHANGELOG.md` (Keep a Changelog)
2. Bump version in `.claude-plugin/plugin.json`
3. `git tag vX.Y.Z` and push
