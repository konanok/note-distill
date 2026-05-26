# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
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
