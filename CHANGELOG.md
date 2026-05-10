# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
