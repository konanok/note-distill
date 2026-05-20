# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Hook-based note candidate pipeline：`UserPromptSubmit` / `Stop` hooks 自动采集会话事件，异步分析生成候选知识点，`/note` 优先消费 candidates/event window，无需完整对话历史
- 三种候选分析器：`claude`（LLM 分析）、`heuristic`（关键词匹配）、`fake`（测试用），支持 fallback 降级
- 候选选择策略：`auto`（按 oldest/newest/priority 自动选）、`pick`（交互式选择）、`all`（实验性全选）
- `/note --auto` / `--pick` / `--all` 命令行参数，可通过 config `candidate_selection` 段配置默认行为
- 并发分析锁机制：防止多次 Stop 快速触发导致 candidates 文件竞态覆盖
- 重分析保护：非确定性分析器重跑时保留已有 pending candidates，避免丢失
- 事件窗口提取：自动识别最近两次 `/note` 间的事件范围，确保增量笔记边界正确
- 项目级配置覆盖：`./.note-distill.json` 深度合并全局配置，按项目定制 adapter、输出路径等
- `merge-config` CLI 命令：输出合并后配置，消除 subagent 手动合并的双源风险
- TIL 模板 `{{upgrade_to}}` 变量：subagent 可判断知识点升级方向
- `local-markdown` adapter 作为 Obsidian 之外的官方支持 adapter

### Planned
- Notion adapter
- 飞书文档 adapter
- `/note-search`：检索已有笔记
- `/note-moc`：自动生成 Map-of-Content 索引
- 已有 quick 笔记升级为 deep 的流程

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
