# note-distill

> 后台 spawn subagent，把当前会话中值得记录的内容按 topic 整理为结构化笔记，写入知识库——**主 session 不被打断**。

## 为什么需要

AI 给出有价值的讨论或方案后，想归档成笔记的两种常见做法：
1. 同 session 让 AI 总结 → 消耗上下文、打断开发节奏
2. 事后手写 → 容易丢失

note-distill：一条 `/note` 指令派发到后台 subagent，独立完成识别 → 按模板结构化 → 验证 → 写入，主 session 立刻回到原任务。

## Quick Start

### 1. 安装

```bash
# GitHub 安装
/plugin install github.com/konanok/note-distill

# 本地路径安装（开发）
/plugin install ~/Projects/Github/note-distill
```

### 2. 初始化

```bash
/note-config
```

按提示选择适配器（local-markdown / obsidian）和输出路径。

### 3. 使用

```
/note                            # 自动判断 topic
/note til                        # 指定 til topic
/note adr NUMA 调度方案           # 指定 adr topic，带描述
/note investigation 导出母机后库存无法归零  # 指定 investigation topic，带描述
/note git stash 只暂存部分文件    # 自动判断 topic + 描述
```

## 核心设计

### Topic 系统

每个 topic 是一个目录，包含两个文件：

```
<name>/
├── prompt.md        # 领域判断标准 + 写作要求
└── template.md      # 输出骨架（frontmatter + section + {{variable}}）
```

**3 级优先级**：项目（`./.note-distill/topics/`）> 用户（`~/.config/note-distill/topics/`）> 出厂（`skills/note/topics/`）。

**出厂 topic**：

| Topic | 场景 |
|---|---|
| `til` | 碎片化速记。单个知识点，≤150 字。AI 会**主动判断**当前知识点是否仅是更大主题的一角，若是则在 frontmatter `follow-up` 字段（同时正文末同步 `- [ ] follow-up: ...` 行）追加最多 1 条具体研究方向，兼容 Obsidian Tasks 跨笔记聚合与 Dataview 查询 |
| `adr` | 架构决策记录，对齐 [MADR 3 short](https://adr.github.io/madr/) 标准。frontmatter 含 `status` / `deciders` / `consulted` / `informed`，body 含 背景与问题陈述 / 决策驱动因素 / 备选方案 / 决策结果（含后果）/ 验证方式 / 各方案利弊 |
| `design` | 架构与设计说明。描述系统/模块/子系统的组件职责、数据流、关键设计决策及已知约束。与 ADR 互补：ADR 记录"为什么选 A 不选 B"，design 记录"整体长什么样、怎么运转" |
| `investigation` | 技术排查报告。记录 bug / 问题的现象→根因→修复全流程。5 Whys 根因链 + 多方案对比修复。可选段：复现方法、验证方案、遗留风险与待办。frontmatter 含 `follow-up`，支持排查后续跟进方向 |

用户自定义：在 `topics_dir` 下建 `<name>/prompt.md` + `<name>/template.md`，`/note <name>` 自动识别。

### 配置

```jsonc
{
  "adapter": "local-markdown",     // 或 "obsidian"
  "output_dir": "/Users/xxx/notes",
  // "obsidian_vault_path": "...", // obsidian 时用这个
  "link_style": "markdown",        // markdown ([text](url)) 或 wikilink ([[概念名]])
  "topics_dir": "~/.config/note-distill/topics",
  "candidate_selection": { ... },
  "candidate_analyzer": { ... }
}
```

### Hook 系统（可选）

被动记录会话事件，异步分析生成候选知识点。`/note` 时按 hook 覆盖度四态决策：
- **`coverage=full`** 且有 candidates / event window → primary path，直接用 candidates / event window
- **`coverage=full`** 但 candidates 和 window 均无内容 → fallback path，subagent 从 events.jsonl 读取对话内容
- **`coverage=partial`**（hook 中途接入）→ fallback path，hook 已捕获片段不可信被忽略，subagent 从 events.jsonl 读取对话内容
- **`coverage=empty`**（hook 未启用或未生效）→ fallback path，subagent 从 events.jsonl 读取对话内容

fallback path 中 subagent 直接读取 events.jsonl（用户 prompt + 助手回复）作为写作素材，无需平台特定环境变量。

## 项目结构

```
.
├── .claude-plugin/           # Plugin 元信息
│   └── plugin.json
├── skills/
│   ├── note/                 # 核心 skill
│   │   ├── SKILL.md          # 主 agent 流程 + spawn prompt
│   │   ├── config.example.json
│   │   ├── references/       # Subagent 行为规范
│   │   └── topics/           # 出厂 topic（til、adr、design、investigation）
│   ├── note-config/          # /note-config
│   └── note-check/           # /note-check
├── hooks/                    # Hook 系统（事件采集 + 候选分析）
└── CLAUDE.md
```

## License

MIT