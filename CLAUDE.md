# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

note-distill is a Claude Code plugin that forks a background subagent to distill technical discussions into structured notes. It supports multiple knowledge base targets (adapters) and note styles; v0.0.1 ships the Obsidian and local-markdown adapters. Invoked via `/note [quick|deep] [--style <style>] [topic]`. All files are Markdown or JSON — no build step, linter, or test framework.

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │  Hook system (hooks/hooks.json)      │
                    │  UserPromptSubmit / Stop triggers     │
                    │  → note_distill_hook.ts collect       │
                    │  → events.jsonl per session           │
                    │  → Stop triggers async analyze        │
                    │  → note_candidates.jsonl per session   │
                    └──────────────┬──────────────────────┘
                                   │ candidates + event window
                                   ▼
/note → skills/note/SKILL.md (argument parsing, style resolution, config check, candidate/window extraction)
      ├── Primary path (candidates or event window available):
      │   general-purpose subagent (background) — explicit input only, no fork needed
      └── Fallback path (nothing available):
          general-purpose subagent (background) — may inherit full history if fork configured

Subagent flow (both paths):
  1. note-writer-protocol.md → workflow + candidate/window/full-history rules
  2. styles/<style>.md → writing philosophy + per-section guidance
  3. templates/<style>-<mode>.md → complete note skeleton (frontmatter + sections + {{variables}})
  4. adapters/<name>.md → target-specific write conventions
  5. fills template variables → validate-note.ts → writes note → marks candidates consumed → reports path via SendMessage

/note-config → skills/note-config/SKILL.md (creates ~/.config/note-distill/)
/note-check → skills/note-check/SKILL.md (validates configuration)
```

Plugin manifest: `.claude-plugin/plugin.json`

**No-summarization rule**: The main agent only parses args, reads config, runs candidate/window helpers, and spawns. It must never summarize or distill content itself. The subagent does all writing work independently.

**Primary vs fallback**: The hook system (`hooks/`) records session events and produces note candidates via an analyzer. When candidates or event window data is available, the subagent uses that explicit input (primary path, no fork needed). Only when nothing is available does it fall back to inheriting full conversation history (fallback path — requires `CLAUDE_CODE_FORK_SUBAGENT=1`, experimental). Set via `.claude/settings.local.json` `env` field (recommended) or shell profile.

## Hook-based candidate pipeline

The hook system (`hooks/`) passively records session events and asynchronously generates note candidates, so `/note` can work without needing full conversation history.

### Data flow

```
UserPromptSubmit hook ──→ run-hook.cmd → note_distill_hook.ts collect ──→ events.jsonl (per session)
Stop hook ──→ run-hook.cmd → note_distill_hook.ts collect ──→ events.jsonl (per session)
                                                └──→ spawns async analyze ──→ note_candidates.jsonl
```

Hooks are triggered via `hooks/hooks.json`, which invokes the cross-platform wrapper `hooks/run-hook.cmd` (handles Windows `.cmd` vs Unix `.ts` execution). The wrapper calls `note_distill_hook.ts collect`, which reads the hook event from stdin.

### Commands

All via `node --experimental-strip-types hooks/note_distill_hook.ts <command>`:

| Command | Purpose |
|---|---|
| `collect` | Reads hook event from stdin, appends to `events.jsonl`. On Stop, spawns async `analyze`. |
| `analyze <events.jsonl> [--output <path>]` | Runs analyzer (heuristic / claude / fake) over events, writes candidates. |
| `window <events.jsonl>` | Extracts the event range between the last two `/note` commands. |
| `candidates <note_candidates.jsonl> [--events <events.jsonl>] [--topic <text>] [--selection auto\|pick\|all] [--strategy oldest\|newest\|priority]` | Filters pending candidates by window + topic, selects per strategy. |
| `context <candidate.json>` | Reads `source_refs` from a candidate and returns the referenced event range. |
| `mark-consumed <note_candidates.jsonl> --ids <csv> --note-path <path>` | Marks candidates as consumed after a successful note write. |
| `parse-model-output <model-output.json> --events <events.jsonl>` | Parses LLM analyzer output into normalized candidates. |
| `merge-config` | Outputs the merged (global + project) config as JSON. Used by the subagent to get a single source of truth. |

### Analyzer providers

Configured via `candidate_analyzer.provider` in user config:

- **`claude`** — spawns `claude --print` with the events as input. Falls back to heuristic if Claude is unavailable or fails.
- **`heuristic`** — keyword-based (matches Chinese tech keywords like 方案→decision, 修复→bugfix, 架构→architecture).
- **`fake`** — always produces exactly one candidate (testing/debugging).

### Selection behaviors

- **`auto`** (default) — auto-picks the best single candidate by strategy.
- **`pick`** — returns pick options; main agent uses `AskUserQuestion` before spawning.
- **`all`** (experimental) — selects all pending candidates in window.

### Secret redaction

The collector redacts `password`, `token`, `api_key`, `secret`, and `Bearer` patterns from hook payloads before writing to `events.jsonl`.

### Concurrency safety

A file-based lock prevents race conditions when multiple Stop hooks fire in quick succession. The analyzer acquires a per-session lock before writing candidates; if locked, subsequent Stop triggers skip analysis. Re-analysis of the same events preserves existing consumed candidates.

## Development workflow

- **No build step** — all files are Markdown or JSON interpreted at runtime. Edit and save; changes take effect immediately (except SKILL.md frontmatter name/description changes, which need `/reload-plugins`).
- **Test without installing:** `claude --plugin-dir ~/Projects/Github/note-distill`
- **Run hook tests:** `node --experimental-strip-types hooks/test_note_distill_hook.mjs` (covers event collection, redaction, candidate pipeline, selection, context, and consumption)
- **Run a single test:** pipe subset of test data through the CLI — e.g. `echo '{"event":"..."}' | node --experimental-strip-types hooks/note_distill_hook.ts collect`

## Key conventions

- **`{SKILL_DIR}`**: Path placeholder in SKILL.md for internal references. Derived from the Skill tool's "Base directory for this skill" output when the skill is loaded — NOT from filesystem computation. Injected by main agent into the subagent spawn prompt. Never hardcode skill paths — the plugin may be installed elsewhere.
- **`fast`/`f`** are aliases for `quick` — normalize before passing to subagent.
- **`--style <name>`**: Supported values: `technical` (default), `til`, `evergreen`. Style files live in `styles/`. Styles define writing philosophy and per-section guidance but do NOT override template structure.
- **Style mode enforcement**: `til` → quick only, `evergreen` → deep only. Output subfolder: `til` → `TIL/`, `evergreen` → `Evergreen/`.
- **Unified template system**: Templates are complete note skeletons (frontmatter + section headings + `{{variable}}` placeholders). Subagent fills variables, doesn't invent structure. Template lookup (4 levels): user `<style>-<mode>.md` → user `<style>.md` → shipped `<style>-<mode>.md` → shipped `<style>.md`. Validate output with `validate-note.ts`.
- **Frontmatter conventions**: All generated notes include `ai-generated: true`, `TODO` + `need-human-review` tags (for human review), and `source: note-distill:<platform>:<session-id>` (traceability).
- **User config** at `~/.config/note-distill/config.json` (global) with optional `./.note-distill.json` project-level override. Project config only needs to specify fields to override; nested objects are deep-merged. The subagent gets a single source of truth via `node --experimental-strip-types hooks/note_distill_hook.ts merge-config` — never manually merge the two files. Example template: `skills/note/config.example.json`.
- **Hook data** at `~/.local/share/note-distill/` (override with `NOTE_DISTILL_DATA_DIR` env var). Per-session: `sessions/<session_id>/events.jsonl` + `note_candidates.jsonl`.
- **Adapters**: One file per output target under `adapters/`. Currently supports `obsidian` (Obsidian vault) and `local-markdown` (local directory). To add Notion/Feishu: new adapter file + new `adapter` value in config + config fields for that target.
- **All `.md` files use LF line endings**. Hook `.ts`/`.mjs` files use LF.
- **User templates**: Users customize note format by creating markdown templates at `~/.config/note-distill/templates/<style>-<mode>.md` or `<style>.md`. Templates use `{{variable}}` placeholders. Plugin ships default templates under `skills/note/templates/`. User templates override shipped ones.
- **Config fields**: when adding a new config field, update both `config.example.json` and (if present locally) `docs/DESIGN.md` §4.1. Both global config and hook `loadConfig()` must support the new field.
- **`docs/` is gitignored**: design docs and ADRs are local-only, not part of the distributed plugin.

## Where to change what

| Task | File |
|---|---|
| Main flow / spawn logic | `skills/note/SKILL.md` |
| Subagent workflow / identification / verification rules | `skills/note/references/note-writer-protocol.md` |
| Note templates (complete skeleton with `{{variables}}`) | `skills/note/templates/<style>-<mode>.md` |
| Note style (writing philosophy + section guidance) | `skills/note/styles/<style>.md` |
| Obsidian write conventions (two-tier: Skill → Write fallback) | `skills/note/adapters/obsidian.md` |
| Local markdown write conventions | `skills/note/adapters/local-markdown.md` |
| Add a new output target (Notion/Feishu) | New `skills/note/adapters/<name>.md` |
| Init / check commands | `skills/note-config/SKILL.md` / `skills/note-check/SKILL.md` |
| Hook triggers (UserPromptSubmit, Stop) | `hooks/hooks.json` |
| Session event collector + candidate analyzer | `hooks/note_distill_hook.ts` |
| Note validation (section/frontmatter/variable checks) | `hooks/validate-note.ts` |
| Cross-platform hook wrapper | `hooks/run-hook.cmd` |
| Hook integration tests | `hooks/test_note_distill_hook.mjs` |

## Directory responsibility (single-responsibility)

| Directory / file | Responsibility | Must NOT contain |
|---|---|---|
| `skills/note/SKILL.md` | Main agent flow + spawn prompt template | Subagent execution logic |
| `references/note-writer-protocol.md` | Subagent behavior spec (identification, verification, validation, reporting) | Note formatting |
| `templates/<style>-<mode>.md` | Complete note skeleton (frontmatter + sections + `{{variable}}` placeholders) | Writing philosophy |
| `styles/<style>.md` | Writing philosophy + per-section guidance for a specific style | Template structure, platform write logic |
| `adapters/<name>.md` | Platform-specific write conventions (filename, path, write method) | Content organization rules |
| `hooks/hooks.json` | Hook trigger registration (UserPromptSubmit, Stop) | Subagent logic |
| `hooks/note_distill_hook.ts` | Event collection, candidate analysis, selection, consumption | Note writing |
| `hooks/validate-note.ts` | Section structure, frontmatter, variable & style constraint validation | Note generation |
| `skills/note-config/SKILL.md` | Initialize user config and templates | Note writing |
| `skills/note-check/SKILL.md` | Validate user configuration | Note writing |

## Testing

### Automated (hook pipeline)

```bash
node --experimental-strip-types hooks/test_note_distill_hook.mjs
```

Runs 14 tests covering: event collector redaction, fail-open on bad JSON, full wrapper→collector→analyzer pipeline, event window extraction, candidate selection (oldest/newest/priority/pick/all), topic filtering, source_refs context reading, model output parsing, fake analyzer, Claude→heuristic fallback, and consumed marking.

### Manual (end-to-end)

1. `/note quick` → short note written to configured target
2. `/note deep` → full note with TL;DR, wikilinks, verification evidence
3. `/note` (no args) → auto mode
4. `/note --style til` → TIL-format note in `{vault}/TIL/`, frontmatter has `status: seed`
5. `/note deep --style evergreen` → evergreen note with proposition-sentence title, 5+ wikilinks
6. Frontmatter includes `ai-generated: true`, `TODO` + `need-human-review` tags, `source: note-distill:<platform>:<session-id>`
7. Subagent reports path on completion via SendMessage
8. `/note --pick` → shows candidate pick list if candidates exist

## Release

1. Update `CHANGELOG.md` (Keep a Changelog)
2. Bump version in `.claude-plugin/plugin.json`
3. `git tag vX.Y.Z && git push && git push --tags`
