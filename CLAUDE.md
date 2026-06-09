# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. `AGENTS.md` is a symlink to this file for cross-tool compatibility (Codex / CodeBuddy / Cursor read `AGENTS.md` by convention) — edit only `CLAUDE.md`.

## Project overview

note-distill is a Claude Code plugin that spawns a background subagent to distill technical discussions into structured notes. It supports multiple output targets (local-markdown, obsidian) and note topics; v0.0.1. Invoked via `/note [<topic>] [描述]`. No build step, no linter, no general test framework — but `hooks/test_note_distill_hook.mjs` is a hand-rolled integration test runner for the hook pipeline.

## Hard boundaries (read first)

- **Main agent never summarizes or distills** — it only parses args, reads config, runs candidate/window helpers, and spawns the subagent. All writing work happens in the subagent.
- **Never hardcode `{SKILL_DIR}`** — always inject from the Skill tool's "Base directory for this skill" output. The plugin may be installed anywhere.
- **Never hand-merge global + project config** — always invoke `node --experimental-strip-types hooks/note_distill_hook.ts merge-config` for the single source of truth.
- **`docs/` is gitignored** — do not add user-facing docs there expecting them to ship with the plugin.

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
/note-distill:note → skills/note/SKILL.md (argument parsing, topic resolution, config check, candidate/window extraction)
      ├── Primary path (COVERAGE=full AND candidates/window available):
      │   general-purpose subagent (background) — runs candidates/window commands itself
      └── Fallback path (COVERAGE=full but no candidates/window, OR partial/empty):
          general-purpose subagent (background) — reads events.jsonl directly for conversation context

Subagent flow (both paths):
  1. note-writer-protocol.md → mechanical workflow + bottom-line constraints
  2. topics/<name>/prompt.md → domain judgment + writing standards
  3. topics/<name>/template.md → complete note skeleton (frontmatter + sections + {{variables}})
  4. fills template variables → validate-note.ts → writes note (mkdir + Write, or hooks/write-<adapter>.ts) → marks candidates consumed → reports path via SendMessage

/note-config → skills/note-config/SKILL.md (creates ~/.config/note-distill/)
/note-check → skills/note-check/SKILL.md (validates configuration)
```

Plugin manifest: `.claude-plugin/plugin.json`

**No-summarization rule**: see "Hard boundaries" above.

**Primary vs fallback**: The hook system (`hooks/`) records session events and produces note candidates via an analyzer. The `window` command on `note_distill_hook.ts` reports a `coverage` field on every call:
- `full` — first UserPromptSubmit in `events.jsonl` is a normal user message (hook was online when the session started).
  - If candidates/window available → **primary** path.
  - If no candidates and no window content → **fallback** path (subagent reads events.jsonl directly).
- `partial` — first UserPromptSubmit is already `/note` (hook only started recording at or after the `/note` invocation; everything earlier is missing). Main agent sets `SOURCE_PATH=fallback` in the spawn prompt to prevent the subagent from mistaking the captured fragment for the full picture, and goes **fallback**.
- `empty` — no events at all. Goes **fallback**.

Fallback path: subagent reads events.jsonl directly (user prompts + assistant responses) as conversation context. No platform-specific env vars required.

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
| `window <events.jsonl>` | Extracts the event range between the last two `/note` commands. Output includes `coverage: full\|partial\|empty` so the main agent can decide primary vs fallback. |
| `candidates <note_candidates.jsonl> [--events <events.jsonl>] [--topic <text>] [--selection auto\|pick\|all] [--strategy oldest\|newest\|priority]` | Filters pending candidates by window + topic, selects per strategy. Output also includes `coverage` (mirrors `window`). |
| `context <candidate.json>` | Reads `source_refs` from a candidate and returns the referenced event range. |
| `mark-consumed <note_candidates.jsonl> --ids <csv> --note-path <path>` | Marks candidates as consumed after a successful note write. |
| `parse-model-output <model-output.json> --events <events.jsonl>` | Parses LLM analyzer output into normalized candidates. |
| `merge-config` | Outputs the merged (global + project) config as JSON. Used by the subagent to get a single source of truth. |

### Analyzer providers

Configured via `candidate_analyzer.provider` in user config:

- **`auto`** — (default) auto-detects the current platform and prefers the matching CLI (Claude Code session → claude CLI first, CodeBuddy session → codebuddy CLI first), then tries the other CLI, then falls back to heuristic.
- **`claude`** — spawns `claude --print` with the events as input. Falls back to heuristic if Claude is unavailable or fails.
- **`codebuddy`** — spawns `codebuddy --print` with the events as input. Falls back to heuristic if CodeBuddy is unavailable or fails.
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
- **Install as plugin (dev):** `/plugin install ~/Projects/Github/note-distill`
- **Run hook tests:** `node --experimental-strip-types hooks/test_note_distill_hook.mjs` (covers event collection, redaction, candidate pipeline, selection, context, and consumption)
- **Run a single test:** pipe subset of test data through the CLI — e.g. `echo '{"event":"..."}' | node --experimental-strip-types hooks/note_distill_hook.ts collect`
- **Validate a note manually:** `node --experimental-strip-types hooks/validate-note.ts <note.md> --template <template.md>` (exit 0 = PASS, 1 = FAIL)

## Key conventions

- **`{SKILL_DIR}`**: Path placeholder in SKILL.md for internal references. Derived from the Skill tool's "Base directory for this skill" output when the skill is loaded — NOT from filesystem computation. Injected by main agent into the subagent spawn prompt. Never hardcode skill paths — the plugin may be installed elsewhere.
- **Topic system**: 3-level lookup: project `./.note-distill/topics/<name>/` → user `<topics_dir>/<name>/` → built-in `skills/note/topics/<name>/`. Each topic contains `prompt.md` (domain judgment + writing standards) and `template.md` (output skeleton). `/note til`, `/note adr`, or user-defined `/note <name>`. Default via config `default_topic` (factory: `til`). User topics override built-in ones.
- **Frontmatter conventions**: All generated notes include `ai-generated: true`, `TODO` + `need-human-review` tags (for human review), and `source: note-distill:<platform>:<session-id>` (traceability).
- **User config** at `~/.config/note-distill/config.json` (global) with optional `./.note-distill.json` project-level override. Project config only needs to specify fields to override; nested objects are deep-merged. The subagent gets a single source of truth via `node --experimental-strip-types hooks/note_distill_hook.ts merge-config` — never manually merge the two files. Example template: `skills/note/config.example.json`.
- **Hook data** at `~/.local/share/note-distill/` (override with `NOTE_DISTILL_DATA_DIR` env var). Per-session: `sessions/<session_id>/events.jsonl` + `note_candidates.jsonl`.
- **Output targets**: Controlled via config `adapter` + `link_style` fields. `local-markdown` → `output_dir`, `[text](url)` links. `obsidian` → `obsidian_vault_path`, `[[wikilink]]` links. Extend via `hooks/write-<adapter>.ts` script.
- **All `.md` files use LF line endings**. Hook `.ts`/`.mjs` files use LF.
- **Config fields**: when adding a new config field, update both `config.example.json` and (if present locally) `docs/DESIGN.md` §4.1. Both global config and hook `loadConfig()` must support the new field.
- **`docs/` is gitignored**: design docs and ADRs are local-only, not part of the distributed plugin.

## File responsibility (single-responsibility)

| File | Responsibility | Must NOT contain |
|---|---|---|
| `skills/note/SKILL.md` | Main agent flow + spawn prompt template | Subagent execution logic |
| `references/note-writer-protocol.md` | Mechanical steps + bottom-line constraints (§0 boundary table) | Domain judgment rules (those live in topic prompt.md) |
| `topics/<name>/prompt.md` | Domain judgment criteria + writing standards | Mechanical workflow rules |
| `topics/<name>/template.md` | Complete note skeleton (frontmatter + sections + {{variable}} placeholders) | Writing philosophy (now in prompt.md) |
| `hooks/hooks.json` | Hook trigger registration (UserPromptSubmit, Stop) | Subagent logic |
| `hooks/note_distill_hook.ts` | Event collection, candidate analysis, selection, consumption | Note writing |
| `hooks/validate-note.ts` | Section structure, frontmatter, variable validation | Note generation |
| `hooks/run-hook.cmd` | Cross-platform hook wrapper | — |
| `hooks/test_note_distill_hook.mjs` | Hook integration tests | — |
| `skills/note-config/SKILL.md` | Initialize user config and topics | Note writing |
| `skills/note-check/SKILL.md` | Validate user configuration | Note writing |

**Extension point — custom write scripts**: To add adapter-specific write logic (e.g. obsidian-cli), the plugin ships `hooks/write-<adapter>.ts`. The subagent prefers this over direct `Write`; failure falls back to `mkdir + Write`. Users do not customize this — it's a plugin developer extension point.

**Protocol vs prompt boundary**: When `note-writer-protocol.md` and a topic's `prompt.md` conflict, protocol wins on workflow, validation, verification strategy, and reporting. prompt.md wins on domain judgment, writing style, and format constraints.

## Testing

### Automated (hook pipeline)

```bash
node --experimental-strip-types hooks/test_note_distill_hook.mjs
```

Covers: event collector redaction, fail-open on bad JSON, full wrapper→collector→analyzer pipeline, event window extraction, candidate selection (oldest/newest/priority/pick/all), topic filtering, source_refs context reading, model output parsing, fake analyzer, Claude→heuristic fallback, project config merge, analyzer locking (fresh + stale), merge-config command, consumed marking, and template validation (section/frontmatter/variable/code block/missing file).

### Manual (end-to-end)

1. `/note git stash` → til topic (default), quick capture
2. `/note adr NUMA 调度` → adr topic
3. `/note` (no args) → til topic with no description
4. `/note --pick` → shows candidate pick list if candidates exist
5. Frontmatter includes `ai-generated: true`, `TODO` + `need-human-review` tags, `source: note-distill:<platform>:<session-id>`, `topic: <name>`
6. Subagent reports path on completion via SendMessage

## Release

1. Update `CHANGELOG.md` (Keep a Changelog)
2. Bump version in `.claude-plugin/plugin.json`
3. `git tag vX.Y.Z && git push && git push --tags`
