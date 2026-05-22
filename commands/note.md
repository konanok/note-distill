---
description: 后台 subagent 将会话内容按 topic 整理为结构化笔记，写入知识库。出厂 til、adr，支持用户自定义 topic。
argument-hint: [til|adr] [可选描述]
---

调用 Skill("note-distill:note")，传入参数 "$ARGUMENTS"。
