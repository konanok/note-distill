# note-distill

> 在后台 fork 一个 subagent，把当前 AI 对话中值得记录的技术方案提炼成结构化笔记，写入你选择的知识库——**主 session 不被打断**。

## 为什么需要这个

AI 给出完美方案后，想归档成笔记的两种常见做法：

1. **同 session 让 AI 总结** → 消耗大量上下文、打断开发节奏
2. **事后手写** → 懒，最终丢失

note-distill 的做法：一条 `/note` 指令派发任务到**后台 fork subagent**，它继承当前会话的完整上下文，独立完成「识别 → 验证 → 按模板结构化 → 写入知识库」，主 session 立刻回到原任务。

## 支持的知识库

| Adapter | 状态 |
|---|---|
| Obsidian | ✅ v0.0.1 |
| Notion | 计划中 |
| 飞书文档 | 计划中 |

## Quick Start

### 1. 安装插件

在 Claude Code 中执行：

```
/plugin install <repo-url>
```

### 2. 写配置

```bash
mkdir -p ~/.config/note-distill
cp "$PWD/skills/note-distill/config.example.json" ~/.config/note-distill/config.json
# 编辑 config.json，设置 adapter 及对应目标（如 obsidian_vault_path）
```

### 3. 使用

```
/note                     # 自动判断深/浅
/note quick               # 短笔记（也可用 fast / q / f）
/note deep                # 深度笔记（也可用 d）
/note deep NUMA 调度问题   # 可带 topic 提示
```

## 笔记模式

### Quick 模式（50-300 字）

适合：临时 tip、小技巧、一条命令

产物：场景 + 代码块 + 可选备注

### Deep 模式（通常 300-1500 字）

适合：完整方案、原理问题、复杂 bug 根因

产物：

- TL;DR
- 背景与问题
- 核心原理
- 解决方案（含代码）
- 备选方案与取舍（表格）
- 边界与陷阱
- 验证证据
- 关联条目（wikilinks）
- 修订历史

## 设计原则

1. **主 session 零开销**：主 agent 只 spawn subagent，不做任何内容提炼
2. **完整上下文**：`subagent_type="fork"` + `run_in_background=true`
3. **深度强制**：deep 模板明令禁止流水账、直接转述对话
4. **自适应验证**：subagent 按内容类型自主选验证手段（源码 / --help / WebFetch / 经验）
5. **Adapter 设计**：知识库无关，新增目标只需添加 `adapters/<name>.md`

## 项目结构

```
.
├── .claude-plugin/         # Claude Code plugin 元信息
│   └── plugin.json
├── skills/note-distill/    # 核心 skill 逻辑
│   ├── SKILL.md            # 主 agent 端流程 + spawn prompt 模板
│   ├── config.example.json # 配置模板
│   ├── references/         # 行为规范 + 笔记模板
│   └── adapters/           # 写入目标适配器（obsidian、未来: notion、feishu）
├── commands/note.md        # Claude Code slash command 转发器
├── docs/                   # 设计文档（本地，不入库）
├── CLAUDE.md
├── README.md
├── CHANGELOG.md
└── LICENSE
```

## 路线图

- [x] Obsidian adapter
- [ ] Notion adapter
- [ ] 飞书文档 adapter
- [ ] `/note-search` 检索已有笔记
- [ ] `/note-moc` 生成 Map-of-Content 索引
- [ ] 已有 quick 笔记升级为 deep 的流程

## License

MIT
