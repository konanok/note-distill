# note-distill Agent Guide

This file is read by Claude Code (as `CLAUDE.md`), CodeBuddy/Codex/Cursor (as `AGENTS.md` via symlink). Edit only `CLAUDE.md` — the symlink handles the rest.

## Project overview

note-distill is a Claude Code plugin that spawns a background subagent to distill technical discussions into structured notes. It supports multiple output targets (local-markdown, obsidian) and note topics; v0.0.1. Invoked via `/note [<topic>] [描述]`. No build step, no linter, no general test framework — but `hooks/test_hooks.mjs` and `skills/note/scripts/test_skills.mjs` are hand-rolled integration test runners for the hook pipeline and skill commands respectively.

## Hard boundaries (read first)

- **Main agent never makes subagent decisions** — main agent only parses `/note` args and handles `--pick` interaction (AskUserQuestion). COVERAGE, SOURCE_PATH, topic resolution, content selection — all subagent decisions.
- **Never hardcode `{SKILL_DIR}`** — always inject from the Skill tool's "Base directory for this skill" output. The plugin may be installed anywhere.
- **Never hand-merge global + project config** — always invoke `node --experimental-strip-types skills/note/scripts/merge-config.ts` for the single source of truth.
- **`docs/` is gitignored** — do not add user-facing docs there expecting them to ship with the plugin.
- **Zero runtime dependencies** — the project runs on `node --experimental-strip-types` with no npm packages. Adding any npm dependency (e.g. TOML/JSONC parser) is a breaking change requiring version bump + migration plan.

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
/note-distill:note → skills/note/SKILL.md (parse /note args → --pick interaction if needed → spawn)
      └── note-writer subagent (background) — self-locates SKILL_DIR, determines COVERAGE/SOURCE_PATH, resolves topic, writes note autonomously

Subagent flow (both paths):
  1. note-writer-protocol.md → mechanical workflow + bottom-line constraints
  2. topics/<name>/prompt.md → domain judgment + writing standards
  3. topics/<name>/template.md → complete note skeleton (frontmatter + sections + {{variables}})
  4. fills template variables → validate-note.ts → writes note (mkdir + Write, or hooks/write-<adapter>.ts) → marks candidates consumed → reports path via SendMessage

/note-config → skills/note-config/SKILL.md (creates ~/.config/note-distill/)
```

Plugin manifest: `.claude-plugin/plugin.json`

**No-summarization rule**: see "Hard boundaries" above.

**Subagent autonomy**: The note-writer subagent (`agents/note-writer.md`) is the single source of truth for all execution logic. It self-locates SKILL_DIR, determines COVERAGE by running `window.ts`, decides SOURCE_PATH, resolves topics via `topic-info.ts`, selects content, and writes notes. The main agent only passes four parameters: TOPIC (from `/note` arg parsing), TOPIC_HINT (remaining text), SELECTED_CANDIDATE_IDS (from `--pick` interaction), and SKILL_DIR (convenience injection; subagent can also self-locate).

Fallback: when no hook data is available (COVERAGE=empty), subagent reads events.jsonl directly.

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

Hook pipeline (still in `hooks/note_distill_hook.ts`):

| Command | Purpose |
|---|---|
| `collect` | Reads hook event from stdin, appends to `events.jsonl`. On Stop, spawns async `analyze`. |
| `analyze <events.jsonl> [--output <path>]` | Runs analyzer (heuristic / claude / fake) over events, writes candidates. |
| `parse-model-output <model-output.json> --events <events.jsonl>` | Parses LLM analyzer output into normalized candidates. |

Skill runtime commands (migrated to `skills/note/scripts/`):

| Script | Purpose |
|---|---|
| `merge-config.ts` | Outputs the merged (global + project) config as JSON. |
| `find-session.ts --cwd <dir>` | Scans session events to locate current session by matching cwd. |
| `window.ts <events.jsonl> \| --session-id <id>` | Extracts the event range between the last two `/note` commands. |
| `candidates.ts <note_candidates.jsonl> [...] \| --session-id <id> [...]` | Filters pending candidates by window + topic, selects per strategy. |
| `context.ts <candidate.json>` | Reads `source_refs` from a candidate and returns the referenced event range. |
| `mark-consumed.ts <note_candidates.jsonl> --ids <csv> --note-path <path> \| --session-id <id> --ids <csv> --note-path <path>` | Marks candidates as consumed after a successful note write. |
| `validate-note.ts <note.md> --template <tpl>` | Validates note structure, frontmatter, and template variables. |
| `topic-info.ts [--name <name>] [--topics-dir <path>]` | Topic metadata queries (alias resolution, scope listing). |

Shared module: `lib/nd-common.ts` — functions shared between hooks and skills (config loading, jsonl I/O, event helpers, CLI parsing, platform detection).

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
- **Run hook tests:** `node --experimental-strip-types hooks/test_hooks.mjs` (covers event collection, redaction, analyzer locking, model output parsing)
- **Run skill tests:** `node --experimental-strip-types skills/note/scripts/test_skills.mjs` (covers config merge, find-session, window, candidates, context, mark-consumed, validate-note, topic-info)
- **Run a single test:** pipe subset of test data through the CLI — e.g. `echo '{"event":"..."}' | node --experimental-strip-types hooks/note_distill_hook.ts collect`
- **Validate a note manually:** `node --experimental-strip-types skills/note/scripts/validate-note.ts <note.md> --template <template.md>` (exit 0 = PASS, 1 = FAIL)

## Key conventions

- **`{SKILL_DIR}` / `$SKILL_DIR`**: `{SKILL_DIR}` appears in SKILL.md (main agent context) — replaced by the Skill tool's "Base directory for this skill" output. `$SKILL_DIR` appears in `agents/note-writer.md` (subagent context) — a variable the subagent self-locates by searching for `skills/note/scripts/merge-config.ts` from the working directory. Both values point to the same `skills/note` directory. Never hardcode skill paths — the plugin may be installed anywhere.
- **Topic system**: 3-level lookup: project `./.note-distill/topics/<name>/` → user `<topics_dir>/<name>/` → built-in `skills/note/topics/<name>/`. Each topic contains `prompt.md` (domain judgment + writing standards) and `template.md` (output skeleton). User topics override built-in ones (higher-priority directory shadows lower). `/note til`, `/note adr`, `/note arch`, `/note investigation`, or user-defined `/note <name>`. Aliases supported via frontmatter (e.g. `/note design` → arch, `/note diag` → investigation). Unspecified → `auto`. Topic resolution is done by the subagent via `topic-info.ts` — including alias resolution and scope-based matching for `auto`. If the user specifies a topic name that doesn't exist, subagent falls back to `auto` rather than failing.
- **Topic frontmatter**: `prompt.md` may include YAML frontmatter with `aliases: [alias1, alias2]` (inline array) and `scope: <single-line natural language>` (describes what this topic records and where its boundaries are). `template.md` and generated notes do NOT use this frontmatter. The subagent queries topic metadata via `node --experimental-strip-types $SKILL_DIR/scripts/topic-info.ts [--name <name>] [--topics-dir <path>]`.
- **Topic routing**: Subagent resolves topic via `topic-info.ts`. Explicit topic name → direct lookup (not-found → auto fallback). `auto` → scope-based matching against all available topics. Candidate type serves as auxiliary signal only.
- **Frontmatter conventions**: All generated notes include `ai-generated: true`, `TODO` tags, `reviewed: false`, and `source: note-distill:<platform>:<session-id>` (traceability).
- **User config** at `~/.config/note-distill/config.json` (global) with optional `./.note-distill.json` project-level override. Project config only needs to specify fields to override; nested objects are deep-merged. The subagent gets a single source of truth via `node --experimental-strip-types skills/note/scripts/merge-config.ts` — never manually merge the two files. Example template: `skills/note/config.example.json`.
- **Hook data** at `~/.local/share/note-distill/` (override with `NOTE_DISTILL_DATA_DIR` env var). Per-session: `sessions/<session_id>/events.jsonl` + `note_candidates.jsonl`.
- **Output targets**: Controlled via config `adapter` + `link_style` fields. `local-markdown` → `output_dir`, `[text](url)` links. `obsidian` → `obsidian_vault_path`, `[[wikilink]]` links. Extend via `hooks/write-<adapter>.ts` script.
- **All `.md` files use LF line endings**. Hook `.ts`/`.mjs` files use LF.
- **Config fields**: when adding a new config field, update both `config.example.json` and (if present locally) `docs/DESIGN.md` §4.1. Both global config and hook `loadConfig()` must support the new field.
- **`docs/` is gitignored**: design docs and ADRs are local-only, not part of the distributed plugin.

## File responsibility (single-responsibility)

| File | Responsibility | Must NOT contain |
|---|---|---|
| `agents/note-writer.md` | Subagent 完整系统 prompt（身份 + SKILL_DIR 自定位 + COVERAGE/SOURCE_PATH 自主决策 + 11 步流程 + 约束）。主 agent 仅注入 TOPIC/TOPIC_HINT/SELECTED_CANDIDATE_IDS/SKILL_DIR。 | 无（单源指令） |
| `skills/note/scripts/topic-info.ts` | Topic metadata queries (alias resolution, scope listing) for subagent and main agent | Note writing, event collection |
| `skills/note/SKILL.md` | 主 agent 流程（解析 /note 参数 → --pick 交互 → spawn） | Subagent 决策逻辑 |
| `references/note-writer-protocol.md` | Adapter 写入协议（输出路径、链接风格、扩展脚本调度、写入后确认） | 工作流步骤、领域判断、验证策略（这些在 agents/note-writer.md 中） |
| `topics/<name>/prompt.md` | Domain judgment criteria + writing standards | Mechanical workflow rules |
| `topics/<name>/template.md` | Complete note skeleton (frontmatter + sections + {{variable}} placeholders) | Writing philosophy (now in prompt.md) |
| `hooks/hooks.json` | Hook trigger registration (UserPromptSubmit, Stop) | Subagent logic |
| `hooks/note_distill_hook.ts` | Event collection, candidate analysis (analyze/parse-model-output) | Note writing |
| `lib/nd-common.ts` | Shared functions: config loading, jsonl I/O, event helpers, CLI parsing, platform detection | — |
| `skills/note/scripts/merge-config.ts` | Merged config output | — |
| `skills/note/scripts/find-session.ts` | Session discovery by cwd | — |
| `skills/note/scripts/window.ts` | Event window extraction | — |
| `skills/note/scripts/candidates.ts` | Candidate selection and filtering | — |
| `skills/note/scripts/context.ts` | Read event range from candidate source_refs | — |
| `skills/note/scripts/mark-consumed.ts` | Mark candidates as consumed | — |
| `skills/note/scripts/validate-note.ts` | Section structure, frontmatter, variable validation | Note generation |
| `hooks/run-hook.cmd` | Cross-platform hook wrapper | — |
| `hooks/test_hooks.mjs` | Hook pipeline integration tests | — |
| `skills/note/scripts/test_skills.mjs` | Skill command integration tests | — |
| `skills/note-config/SKILL.md` | Initialize user config and topics | Note writing |

**Extension point — custom write scripts**: To add adapter-specific write logic (e.g. obsidian-cli), the plugin ships `hooks/write-<adapter>.ts`. The subagent prefers this over direct `Write`; failure falls back to `mkdir + Write`. Users do not customize this — it's a plugin developer extension point.

**Protocol vs prompt boundary**: `agents/note-writer.md` is the single source of truth for the subagent's workflow (steps, validation, reporting, constraints). `note-writer-protocol.md` handles only the write adapter layer (how to write based on adapter type). When the two conflict, agents/note-writer.md wins on workflow; protocol wins on adapter-specific write logic.

## Testing

### Automated (hook pipeline)

```bash
node --experimental-strip-types hooks/test_hooks.mjs && node --experimental-strip-types skills/note/scripts/test_skills.mjs
```

Covers: event collector redaction, fail-open on bad JSON, full wrapper→collector→analyzer pipeline, event window extraction, candidate selection (oldest/newest/priority/pick/all), topic filtering, source_refs context reading, model output parsing, fake analyzer, Claude→heuristic fallback, project config merge, analyzer locking (fresh + stale), merge-config command, consumed marking, and template validation (section/frontmatter/variable/code block/missing file).

### Manual (end-to-end)

1. `/note git stash` → til topic (default), quick capture
2. `/note adr NUMA 调度` → adr topic
3. `/note investigation 导出母机后库存无法归零` → investigation topic
4. `/note arch 微服务拆分` → design topic (alias)
5. `/note diag OOM 排查` → investigation topic (alias)
6. `/note` (no args) → auto routing via scope-based matching
7. `/note --pick` → shows candidate pick list if candidates exist
8. Frontmatter includes `ai-generated: true`, `TODO` tags, `reviewed: false`, `source: note-distill:<platform>:<session-id>`, `type: <topic>`
9. Subagent reports path on completion via SendMessage

## Release

1. Update `CHANGELOG.md` (Keep a Changelog)
2. Bump version in `.claude-plugin/plugin.json`
3. `git tag vX.Y.Z && git push && git push --tags`
