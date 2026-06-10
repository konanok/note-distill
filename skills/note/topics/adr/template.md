---
title: "{{title}}"
type: adr
created: { { datetime } }
updated: { { datetime } }
status: proposed
deciders: []
consulted: []
informed: []
ai-generated: true
reviewed: false
source: note-distill:{{platform}}:{{session_id}}
tags: [adr, { { domain_tags } }, ai-generated, TODO]
---

# {{title}}

## 背景与问题陈述

{{context}}

<!--
描述触发本次决策的背景、问题、约束。150–300 字。
不写解决方案，不写选型对比 — 只回答"我们为什么需要做这个决策"。
如对话只提到结论而未交代背景，整段写"（背景未在对话中讨论，待补充）"，
不要从训练知识里补全背景。
-->

## 决策驱动因素

{{drivers}}

<!--
影响选型的关键因素，bullet list，每条一行。
例：性能、可维护性、上线时间、团队熟悉度、合规要求。
如对话未明确提及，整段写"（决策驱动因素未在对话中讨论，待补充）"，不要编。
-->

## 备选方案

{{options}}

<!--
**只列名 + 一句话定位，不写优缺点**（优缺点放最后一段"各方案利弊"）。
bullet list，每条一行。至少 2 个 — 这是 ADR 的硬门槛，少于 2 个应当
退回到 prompt 顶部"该记什么"重新判断是否走 til。

例：
- 方案 A：使用 epoll 直接调度
- 方案 B：通过 io_uring 异步提交
- 方案 C：保持现状（baseline）
-->

## 决策结果

**选定方案**：{{chosen_option}}

{{decision_rationale}}

<!--
一段话说明：选了哪个方案、为什么选它（呼应"决策驱动因素"）。100–200 字。
如对话只提到结论没提理由，写"（决策理由未在对话中讨论，待补充）"。
-->

### 后果

{{consequences}}

<!--
必须包含正面和负面后果，bullet list：
- ✅ 正面：...
- ⚠️ 负面 / 取舍：...

这是决策档的核心价值 — 不写后果就退化成日记。
如对话未讨论后果，整段写"（后果未在对话中讨论，待补充）"，不要编。
-->

## 验证方式

{{confirmation}}

<!--
怎么验证这个决策真的落地、是对的？bullet list。
例：
- 跑 benchmark X，吞吐应 ≥ Y
- code review 时检查 Z
- 上线后观察指标 M 一周

如对话未讨论，整段写"（验证方式未在对话中讨论，待补充）"。
-->

## 各方案利弊

{{pros_and_cons}}

<!--
对每个备选方案逐一展开：

### 方案 A：xxx
- 优点：...
- 缺点：...
- 适用场景：...

### 方案 B：xxx
- 优点：...
- 缺点：...
- 适用场景：...

如某方案在对话中讨论很少，对应小节写"（方案 X 利弊未在对话中讨论，待补充）"。
-->
