---
title: "{{title}}"
type: design
created: { { datetime } }
updated: { { datetime } }
ai-generated: true
reviewed: false
source: note-distill:{{platform}}:{{session_id}}
tags: [design, { { domain_tags } }, ai-generated, TODO]
---

# {{title}}

## 概览

{{overview}}

<!--
一段话（100-200 字），说清这个子系统是什么、解决什么问题、核心思路。
读完应该能判断"这篇和我有关吗"以及"这个系统的定位是什么"。
不展开实现细节。
-->

## 组件概览

{{component_overview}}

<!--
表格式速查，每个组件一行：

| 组件 | 职责 | 不负责 |
|------|------|--------|
| commandCollect | 采集事件，触发异步分析 | 分析逻辑本身 |
| commandAnalyze | ... | ... |

职责列 ≤1 句话。不负责列写清显式边界，防止读者误以为某组件做了它没做的事。
-->

## 组件详述

{{component_details}}

<!--
按数据流顺序排列，每个组件一个小节：

### commandCollect

核心逻辑：...
关键实现细节：...
与其他组件的交互：...

如对话对某组件讨论很少，写"（组件 X 详述未在对话中讨论，待补充）"，不要从训练知识里编。
-->

## 数据流

{{data_flow}}

<!--
优先用 ASCII 流程图展示端到端流转，辅以文字说明。

例：
```text
UserPromptSubmit / Stop
       │
       ▼
  commandCollect()
       ├── events.jsonl
       └── async analyze
               │
               ▼
         commandAnalyze() → note_candidates.jsonl
               │
               ▼
         commandCandidates() → 筛选结果
```

如对话未提供足够信息画出完整流程，画出已知部分，缺失节点标注"（待补充）"。
-->

## 关键设计决策

{{design_decisions}}

<!--
列出 3-5 个值得记录的决策点，每条格式：

- **决策**：一句话描述做了什么选择
- **理由**：为什么这样做（呼应概览中的核心问题）
- **代价**：放弃了什么、引入了什么风险

如果同一决策已有 ADR，只写摘要 + 链接：
- **决策**：选择文件锁而非数据库 → 详见 [ADR: 候选词存储方案](path/to/adr.md)

如对话未讨论某条决策的理由或代价，照实写"（理由/代价未在对话中讨论，待补充）"。
-->

## 已知约束与未决问题

{{constraints}}

<!--
bullet list，诚实记录：
- 当前方案的限制
- 技术债
- 待验证的假设

如对话未提及，写"（未在对话中讨论，待补充）"。
-->
