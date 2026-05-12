# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project overview

note-distill is a Claude Code plugin that forks a background subagent to distill technical discussions into structured notes. It supports multiple knowledge base targets (adapters) and note styles; v0.0.1 ships the Obsidian and local-markdown adapters. Invoked via `/note [quick|deep] [--style <style>] [topic]`. All files are Markdown or JSON — no build step, linter, or test framework.

## Architecture

```
/note → skills/note/SKILL.md (argument parsing, style resolution, config check, spawns fork subagent [experimental])
      → fork subagent (background):
        1. note-writer-protocol.md → workflow
        2. styles/<style>.md → writing philosophy
        3. {quick,depth}-template.md → content structure
        4. templates/<style>.md → markdown template (frontmatter + layout)
        5. adapters/<name>.md → target-specific write conventions
        6. writes note to knowledge base, reports path via SendMessage

/note-config → skills/note-config/SKILL.md (creates ~/.config/note-distill/)
/note-check → skills/note-check/SKILL.md (validates configuration)
```

Plugin manifest: `.claude-plugin/plugin.json`

**Zero-summarization rule**: The main agent only parses args, reads config, and spawns. The subagent inherits full conversation context via fork and does all work independently. Requires `CLAUDE_CODE_FORK_SUBAGENT=1` (experimental, Claude Code v2.1.117+). Set via `.claude/settings.local.json` `env` field (recommended) or shell profile.

## Installation & activation

Install via Claude Code's built-in plugin manager. Claude Code auto-discovers `skills/` from the installed plugin directory — no manual symlinks or `mkdir`.

```bash
# From GitHub (end users)
/plugin install github.com/konanok/note-distill

# From local path (development)
/plugin install ~/Projects/Github/note-distill
```

For local development, use `--plugin-dir` to test without installing:

```bash
claude --plugin-dir ~/Projects/Github/note-distill
```

Then `/reload-plugins` to pick up changes without restarting. Changes to project files take effect immediately except for SKILL.md frontmatter `name`/`description` field changes, which require a restart.

## Key conventions

- **`{SKILL_DIR}`**: Path placeholder in SKILL.md for internal references. Derived from the Skill tool's "Base directory for this skill" output when the skill is loaded — NOT from filesystem computation. Injected by main agent into the subagent spawn prompt. Never hardcode skill paths — the plugin may be installed elsewhere.
- **`fast`/`f`** are aliases for `quick` — normalize before passing to subagent.
- **`--style <name>`**: Supported values: `technical` (default), `til`, `evergreen`. Style files live in `styles/`. Style overrides template structure and frontmatter.
- **Style cross-cutting rules**: A style file can override: (1) template structure, (2) mode (`til`→quick, `evergreen`→deep), (3) output path (`til`→`TIL/`, `evergreen`→`Evergreen/`，覆盖 config 的 `subfolder_by_mode`)。Always check all three when reading a style file.
- **Frontmatter conventions**: All generated notes include `ai-generated: true`, `TODO` + `need-human-review` tags (for human review), and `source: note-distill:<platform>:<session-id>` (traceability).
- **User config** at `~/.config/note-distill/config.json` (not in plugin tree). Example template: `skills/note/config.example.json`.
- **Adapters**: One file per output target under `adapters/`. Currently supports `obsidian` (Obsidian vault) and `local-markdown` (local directory). To add Notion/Feishu: new adapter file + new `adapter` value in config + config fields for that target.
- **All `.md` files use LF line endings**.
- **User templates**: Users customize note format by creating markdown templates at `~/.config/note-distill/templates/<style>.md` or `templates/default.md`. Templates use `{{variable}}` placeholders (`{{date}}`, `{{title}}`, `{{content}}`, `{{domain_tags}}`, etc.). Plugin ships default templates under `skills/note/templates/`. User templates override shipped ones.
- **Config fields**: when adding a new config field, update both `config.example.json` and (if present locally) `docs/DESIGN.md` §4.1.
- **`docs/` is gitignored**: design docs and ADRs are local-only, not part of the distributed plugin.

## Where to change what

| Task | File |
|---|---|
| Main flow / spawn logic | `skills/note/SKILL.md` |
| Subagent workflow / identification / verification rules | `skills/note/references/note-writer-protocol.md` |
| Note templates (quick/deep) | `skills/note/references/{quick,depth}-template.md` |
| Note style (writing philosophy) | `skills/note/styles/<style>.md` |
| Note template (frontmatter + layout) | `skills/note/templates/<style>.md` |
| Obsidian write conventions (two-tier: Skill → Write fallback) | `skills/note/adapters/obsidian.md` |
| Local markdown write conventions | `skills/note/adapters/local-markdown.md` |
| Add a new output target (Notion/Feishu) | New `skills/note/adapters/<name>.md` |
| Init / check commands | `skills/note-config/SKILL.md` / `skills/note-check/SKILL.md` |

## Directory responsibility (single-responsibility)

| Directory / file | Responsibility | Must NOT contain |
|---|---|---|
| `skills/note/SKILL.md` | Main agent flow + spawn prompt template | Subagent execution logic |
| `references/note-writer-protocol.md` | Subagent behavior spec (identification, verification, reporting) | Note formatting |
| `references/{quick,depth}-template.md` | Note structure template + anti-patterns | Write logic |
| `styles/<style>.md` | Writing philosophy + content rules for a specific style | Platform write logic |
| `templates/<style>.md` | Markdown template (frontmatter layout + `{{variable}}` placeholders) | Writing philosophy |
| `adapters/<name>.md` | Platform-specific write conventions (filename, path, write method) | Content organization rules |
| `skills/note-config/SKILL.md` | Initialize user config and templates | Note writing |
| `skills/note-check/SKILL.md` | Validate user configuration | Note writing |

## Testing

Manual verification:

1. `/note quick` → short note written to configured target
2. `/note deep` → full note with TL;DR, wikilinks, verification evidence
3. `/note` (no args) → auto mode
4. `/note --style til` → TIL-format note in `{vault}/TIL/`, frontmatter has `status: seed`
5. `/note deep --style evergreen` → evergreen note with proposition-sentence title, 5+ wikilinks
6. Frontmatter includes `ai-generated: true`, `TODO` + `need-human-review` tags, `source: note-distill:<platform>:<session-id>`
7. Subagent reports path on completion via SendMessage

## Release

1. Update `CHANGELOG.md` (Keep a Changelog)
2. Bump version in `.claude-plugin/plugin.json`
3. `git tag vX.Y.Z` and push
