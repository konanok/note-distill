# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `/add-topic` skill: 通过自然语言创建自定义 note-distill topic。包含 `topic-creation-guide.md` 参考规范（从出厂 topic 提取的最小公约）。自动生成 `prompt.md` + `template.md`，默认放用户级目录，支持事后迁移到项目级。校验用 `topic-info.ts`。
- `runbook` topic (aliases: `playbook`, `troubleshooting`): 排查操作手册，记录因操作不当、数据缺失或参数遗漏导致的问题（系统行为符合程序预期，非代码缺陷）。与 `investigation` 的核心判断线——系统行为是否符合程序预期？符合预期（操作问题）→ runbook；不符合预期（代码缺陷）→ investigation。必填段：适用症状、问题链路、排查步骤、代码线索。排查步骤要求完整可执行语句 + 判断分支 + 必要时 ASCII/mermaid 决策图。
- `arch` topic diagram guidance: 组件详述段支持 ASCII 时序图 / mermaid sequenceDiagram；数据流段支持 mermaid flowchart（简单用 ASCII，复杂用 mermaid）。

### Changed

- **Breaking**: `design` topic renamed to `arch`. Canonical name `design` → `arch`; `design` becomes an alias. Template `type: design` → `type: arch`; tags `[design, ...]` → `[arch, ...]`. Existing notes with `type: design` still valid but canonical name has changed. Project-level overrides at `./.note-distill/topics/design/` need manual rename to `./.note-distill/topics/arch/`.

- Topic frontmatter: `aliases` and `scope` fields in `prompt.md` for declarative topic metadata. Scope provides a concise natural-language routing description; aliases enable alternative topic names without renaming directories.
- `scripts/topic-info.ts` (under skill directory) helper command: structured topic metadata queries for subagent (alias resolution + scope-based auto routing). Replaces manual directory scanning and "read first 20 lines" convention.
- Topic aliases: `arch`/`architecture` → design, `diag` → investigation. (renamed in Unreleased — now `arch` is canonical and `design` is alias)
- SKILL.md subagent prompt uses `topic-info` for alias resolution and scope-based routing. Candidate type (`decision`, `architecture`, etc.) retained as auxiliary routing signal, no longer the sole routing determinant.

### Changed

- Topic `prompt.md` structure: "该记什么"/"不该记" sections replaced by frontmatter `scope` (routing) + body "记录标准"/"边界与排他" (writing guidance). Pure exclusion rules (e.g., "不记录闲聊") merged into body sections.
- `argument-hint` expanded: `[til|adr|design|arch|investigation|diag]` to include aliases.
- `design` topic: architecture + design rationale notes, complementing TIL (atomic knowledge) and ADR (decision records with ≥2 alternatives). 6-section template: 概览 → 组件概览 → 组件详述 → 数据流 → 关键设计决策 → 已知约束与未决问题. Supports ADR cross-reference in the key design decisions section.
- `investigation` topic: technical debugging / troubleshooting reports. Records the full flow from symptom → reproduce → root cause → fix → verify → remaining risks. 5 Whys root cause chain + multi-option fix comparison. Optional sections (not in template, inserted on demand in investigation order): 复现方法 (after symptom), 验证方案 (after fix), 遗留风险与待办 (after verify). `follow-up` frontmatter field for tracking post-investigation actions.

- Subagent prompt refactored: main agent no longer injects JSON blobs (NOTE_CANDIDATES, NOTE_EVENT_WINDOW, PLATFORM, SESSION_ID, EVENT_LOG_PATH, CANDIDATE_LOG_PATH). Instead, subagent discovers platform/session/paths itself and runs candidates/window commands to get data. Main agent only injects scalar parameters (TOPIC, TOPIC_HINT, SKILL_DIR, COVERAGE, SOURCE_PATH, SELECTED_CANDIDATE_IDS). This makes spawning more reliable — LLM-based main agents often failed to properly inject large JSON outputs.
- Path selection expanded from 3-state to 4-state: COVERAGE=`full` without candidates/window now also goes fallback (subagent reads events.jsonl directly), instead of being lumped with the primary path.
- Removed fork subagent dependency (the `CLAUDE_CODE_FORK_SUBAGENT=1` requirement from the previous fallback mechanism is no longer needed). Fallback path now reads events.jsonl directly (platform-agnostic, no prompt injection required). SKILL.md, CLAUDE.md, and README.md updated accordingly. The "structured warning about fork inheritance" from previous versions is also removed.
- CodeBuddy Task spawn mechanism now includes `description="写笔记"` parameter.
- Candidate analyzer default provider changed from `claude` to `auto`. The `auto` provider detects the current platform (Claude Code or CodeBuddy) and prefers the matching CLI for analysis, falling back to the other CLI, then to heuristic.
- `repairTruncatedJson` now surfaces a `repaired: true` flag on candidate objects when JSON repair was applied, for observability of potentially truncated data.
- `parse-model-output` command output now includes a `repaired` boolean field indicating whether the input JSON was repaired.
- `findExecutable` now uses `path.delimiter` instead of hardcoded `:` for PATH splitting, improving Windows compatibility.

- **Refactor**: Migrated 6 runtime commands + `validate-note.ts` from `hooks/` to `skills/note/scripts/`:
  `merge-config`, `find-session`, `window`, `candidates`, `context`, `mark-consumed`, `validate-note`.
  Extracted shared functions to `lib/nd-common.ts`.
  `hooks/note_distill_hook.ts` reduced from 1465 to 876 lines, retaining only `collect` + `analyze` + `parse-model-output`.
  Split monolithic test file into `hooks/test_hooks.mjs` (16 tests) + `skills/note/scripts/test_skills.mjs` (41 tests).
  Zero behavioral change — all 57 tests pass across both test suites.

### Added

- Anti-recursion guard: `commandCollect` checks `NOTE_DISTILL_ANALYZER_CHILD=1` env var and skips all work if set, preventing infinite hook→analyzer→hook loops.
- `maybeStartAnalyzer` and `buildCliCandidates` now inject `NOTE_DISTILL_ANALYZER_CHILD=1` into child process environments so their hook triggers are no-ops.
- `buildCliCandidates` passes `--bare` flag to `claude` CLI to skip hook loading entirely (Claude Code bare mode).
- `candidate_analyzer.enabled` config field (default `true`). Set to `false` to disable automatic candidate extraction; `maybeStartAnalyzer` and `commandAnalyze` will skip entirely. Also overridable via `NOTE_DISTILL_ANALYZER_ENABLED` env var.
- `analyzerConfig()` now returns an `enabled` boolean field.
- Tests: `testCollectorSkipsWhenAnalyzerChild`, `testAnalyzerDisabledSkipsCandidateExtraction`, `testMergeConfigIncludesEnabledField`.

- `codebuddy` provider: spawns `codebuddy --print` for candidate analysis, mirroring the existing `claude --print` flow.
- `auto` provider: platform-aware CLI detection — prefers the same-platform CLI (CodeBuddy session → codebuddy CLI first, Claude Code session → claude CLI first), then tries the other CLI, then falls back to heuristic.
- `CLI_MODEL_MAP`: semantic model name mapping per provider (`haiku`/`sonnet`/`opus` → provider-specific CLI model IDs). CodeBuddy maps `haiku` → `deepseek-v4-flash-ioa`, `sonnet` → `claude-sonnet-4.7`, `opus` → `claude-opus-4.7`.
- `stripMarkdownCodeBlock()`: strips ```json code block wrapping from LLM output before parsing.
- `repairTruncatedJson()`: closes open strings/brackets/braces in truncated LLM JSON output using a nesting stack approach.
- `buildCliCandidates()` logs stderr when CLI execution fails (status ≠ 0) for easier debugging.
- Tests: `testParseModelOutputRepairsTruncatedJson`, `testParseModelOutputNoRepairOnValidJson`, `testParseModelOutputStripsMarkdownCodeBlock` covering the new pure functions.

### Changed

- `{{date}}` 模板变量重命名为 `{{datetime}}`，frontmatter 中 `created`/`updated` 格式从 `YYYY-MM-DD` 改为 `YYYY-MM-DD HH:MM:SS`。移除 `date +%Y-%m-%d` 等平台特定命令硬编码，改为平台无关获取方式。输出文件名中的 `{date}` 仍为 `YYYY-MM-DD`。

### Added

- Hook coverage detection: `window` and `candidates` commands now report a `coverage` field (`full` / `partial` / `empty`) so the main agent can decide between primary and fallback paths reliably. `partial` is triggered when the first `UserPromptSubmit` in `events.jsonl` is already a `/note` invocation — meaning the hook joined mid-session (typically: user had a long conversation before installing the plugin) and the captured fragment is not a trustworthy representation of session content.
- Fallback path is now actively taken on `coverage=partial`, not just `coverage=empty`. Main agent forces `NOTE_CANDIDATES` / `NOTE_EVENT_WINDOW` to `unavailable` to prevent the subagent from mistaking the partial fragment for the full picture. Subagent reads the main session history directly (requires `CLAUDE_CODE_FORK_SUBAGENT=1`).
- Subagent spawn prompt now contains a dedicated **Fallback 模式专用指令** block that activates when `SOURCE_PATH=fallback`: explicit guidance on reading main session history, a structured warning to surface when fork inheritance isn't enabled, and instruction to skip `mark-consumed` (no candidate IDs to mark).
- `find-session` command: scans `DATA_DIR/sessions/*/events.jsonl` to locate the current session by matching `cwd`, returns `{ session_id, platform }`. Platform is derived from `transcript_path` (`.claude/` → `claude-code`, `CodeBuddyExtension`/`.codebuddy/` → `codebuddy`) — cross-platform, no reliance on macOS-specific env vars.
- SKILL.md PLATFORM/SESSION_ID detection now uses a three-level fallback: (1) `$CLAUDE_CODE_SESSION_ID` → `claude-code` + session ID, (2) `find-session --cwd <pwd>` → session ID + platform from hook data, (3) `unknown`. Fixes `source: note-distill:unknown:unknown` on CodeBuddy.

### Changed

- **Breaking**: `til` and `adr` template frontmatter aligned with Karpathy-style LLM Wiki schema. Added `type: til|adr` (so wiki tooling recognizes the page type), `updated: {{date}}` (mirrors `created` on first write; wiki lint maintains it afterward), `reviewed: false` (wiki uses this flag for unreviewed AI-generated pages). Removed `topic: til|adr` (redundant with `type`) and dropped `need-human-review` tag (the `TODO` tag plus `reviewed: false` already cover this). `title` values are now quoted for YAML safety. Existing notes without the new fields remain valid for reading; re-run `/note` to regenerate if you want them migrated.
- **Breaking**: `adr` topic redesigned to align with [MADR 3 short](https://adr.github.io/madr/) standard. New body structure: 背景与问题陈述 / 决策驱动因素 / 备选方案 / 决策结果（含 ### 后果）/ 验证方式 / 各方案利弊. New frontmatter fields: `status` (defaults `proposed`), `deciders`, `consulted`, `informed`.
- `adr` template now embeds per-section HTML comments specifying what to write / when to leave blank — guards AI against fabricating content for fields it can't confidently fill. All blank-fallback messages follow a unified phrasing `（X 未在对话中讨论，待补充）` so reviewers can `grep "待补充"` across the vault.
- `adr` prompt: hard criteria for what qualifies as ADR (≥2 options upfront + engineering tradeoff), explicit `status` rules (default `proposed`; only `accepted` with explicit "已实施/已上线" evidence; ambiguity → fall back to `proposed`), retrospective handling (including the dual-layer "复盘 + 重新评估" case → produce only one new `proposed` ADR), third-person voice, data-over-adjectives style.
- Old ADR notes are NOT auto-migrated — keeping with append-only ADR convention; old notes remain valid in their original format. `hooks/validate-note.ts` only enforces structure when explicitly run with `--template`, so existing notes are not auto-checked against the new schema.
- **Breaking**: Topic-driven architecture. `/note [<topic>] [描述]` — each topic bundles prompt.md (domain judgment) + template.md (output skeleton).
- **Breaking**: Flat template design replaces mode × style system. `/note [<topic>] [描述]` — no more `quick`/`deep`/`auto` modes or `--style` flag.
- Removed `styles/` directory; removed `templates/` directory, replaced with `topics/` (til, adr).
- Config: `subfolder_by_mode`, `default_style`, `style_overrides`, `auto_mode_heuristic` removed; `default_template` → `default_topic`, `templates_dir` → `topics_dir`.
- `note-writer-protocol.md` simplified to mechanical steps only; domain judgment moved to topic `prompt.md`.
- Output path simplified: `<output_dir>/<date>-<slug>.md` (no mode subdirectory).
- Removed `adapters/` directory; write logic unified in protocol §4. `adapter` + `link_style` config fields control target and link format.

### Added

- `til` topic now supports a `follow-up` frontmatter field (array, defaults `[]`) for AI-generated knowledge-extension hooks. AI proactively judges whether a note's topic has ≥3 useful unexplored sub-points at the same abstraction level; if so, generates **at most one** specific actionable direction. Mirrored as `- [ ] follow-up: <text>` in note body for Obsidian Tasks plugin compatibility (cross-note aggregation), while frontmatter array supports Dataview queries. Existing til notes without the field remain valid.
- Hook system: UserPromptSubmit/Stop triggers auto-collect session events, async analyze for note candidates via claude/heuristic/fake providers.
- Candidate selection: auto (oldest/newest/priority), pick (interactive), all.
- `merge-config` CLI command for resolved config output.
- Project-level config: `./.note-distill.json` deep-merges over global config.
- `link_style` config field: `markdown` for `[text](url)`, `wikilink` for `[[概念名]]`.
- Extension point: `hooks/write-<adapter>.ts` for custom write scripts (falls back to `mkdir + Write`).
- Secret redaction, PATH-based claude lookup, configurable lock timeout.

## [0.0.1] - 2026-05-09

### Added

- 初始版本：`/note`、`/note quick|fast|q|f`、`/note deep|d`、`/note <topic>` 四种触发方式
- 核心执行流程：主 agent spawn `subagent_type="fork"` + `run_in_background=true`，零摘要、零加工
- 三种笔记模式：`quick`（短笔记）、`deep`（深度笔记）、`auto`（由 subagent 自行判断）
- Obsidian adapter：frontmatter、wikilinks、按模式分子目录、文件名冲突处理
- 两种模板：`quick-template.md`（50-300 字 + 代码块）、`depth-template.md`（TL;DR/原理/备选对比/边界/验证证据）
- Subagent 行为规范：`note-writer-protocol.md`，定义识别、验证、回报流程
- `fast` / `f` 作为 `quick` / `q` 的别名，主 agent 归一化后内部统一为 `quick`
- SKILL.md 路径解耦：用 `{SKILL_DIR}` 占位，plugin 装到任何位置都能跑
- Plugin 化：符合 Claude Code plugin 规范（`.claude-plugin/plugin.json`）
- 用户级配置文件 `~/.config/note-distill/config.json`（不在 plugin 内，避免升级覆盖）
- Adapter 架构：写入目标与笔记逻辑解耦，新增知识库只需添加 `adapters/<name>.md`
- 三种笔记风格：`technical`（默认，技术沉淀）、`til`（Today I Learned，极简速记，`status: seed`）、`evergreen`（命题句标题，观点积累，5-10 wikilinks）
- Style 解析与优先级：命令行 `--style <name>` > config `style_overrides.<mode>` > `default_style` > 兜底 `technical`
- 用户文档：README.md（项目介绍 + 快速上手）、USAGE.md（完整操作指南）
