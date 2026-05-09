# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project overview

note-distill is a Claude Code plugin that forks a background subagent to distill technical discussions into structured notes. It supports multiple knowledge base targets (adapters); v0.0.1 ships the Obsidian adapter. Invoked via `/note [quick|deep] [topic]`. All files are Markdown or JSON — no build step, linter, or test framework.

## Architecture

```
/note → commands/note.md (argument parsing)
      → skills/note-distill/SKILL.md (reads config, spawns fork subagent)
        → fork subagent (background):
          1. note-writer-protocol.md → workflow
          2. {quick,depth}-template.md → content structure
          3. adapters/<name>.md → target-specific write conventions
          4. writes note to knowledge base, reports path via SendMessage
```

Plugin manifest: `.claude-plugin/plugin.json`

**Zero-summarization rule**: The main agent only parses args, reads config, and spawns. The subagent inherits full conversation context via fork and does all work independently.

## Activation

Install via `/plugin install` from GitHub or local path. Claude Code auto-discovers commands and skills from `commands/` and `skills/` directories.

## Key conventions

- **`{SKILL_DIR}`**: Path placeholder in SKILL.md for internal references — injected by main agent at spawn time. Never hardcode skill paths — the plugin may be installed elsewhere.
- **`fast`/`f`** are aliases for `quick` — normalize before passing to subagent.
- **User config** at `~/.config/note-distill/config.json` (not in plugin tree). Example template: `skills/note-distill/config.example.json`. `.gitignore` excludes `**/note-distill/config.json`.
- **Adapters**: One file per output target under `adapters/`. Templates and protocol are target-agnostic. To add Notion/Feishu: new adapter file + new `adapter` value in config + config fields for that target.
- **All `.md` files use LF line endings**.
- **Config fields**: when adding a new config field, update both `config.example.json` and `docs/DESIGN.md` §4.1.
- **`docs/` is gitignored**: design docs and ADRs are local-only, not part of the distributed plugin.

## Where to change what

| Task | File |
|---|---|
| Main flow / spawn logic | `skills/note-distill/SKILL.md` |
| Subagent workflow / identification / verification rules | `skills/note-distill/references/note-writer-protocol.md` |
| Note templates (quick/deep) | `skills/note-distill/references/{quick,depth}-template.md` |
| Obsidian write conventions | `skills/note-distill/adapters/obsidian.md` |
| Add a new output target (Notion/Feishu) | New `skills/note-distill/adapters/<name>.md` + new `adapter` value in config |
| Command argument parsing / aliases | `commands/note.md` + SKILL.md Step 2 |

## Directory responsibility (single-responsibility)

| Directory / file | Responsibility | Must NOT contain |
|---|---|---|
| `skills/note-distill/SKILL.md` | Main agent flow + spawn prompt template | Subagent execution logic |
| `references/note-writer-protocol.md` | Subagent behavior spec (identification, verification, reporting) | Note formatting |
| `references/{quick,depth}-template.md` | Note structure template + anti-patterns | Write logic |
| `adapters/<name>.md` | Platform-specific write conventions (frontmatter, filename, API) | Content organization rules |
| `commands/note.md` | Parse command args + delegate to skill | Any business logic |

## Testing

Manual verification:

1. `/note quick` → short note written to configured target
2. `/note deep` → full note with TL;DR, wikilinks, verification evidence
3. `/note` (no args) → auto mode
4. Frontmatter includes tags, source, mode, created, aliases
5. Subagent reports path on completion via SendMessage

## Release

1. Update `CHANGELOG.md` (Keep a Changelog)
2. Bump version in `.claude-plugin/plugin.json`
3. `git tag vX.Y.Z` and push
