---
description: 把当前会话中的技术方案派发到后台 fork subagent，写入配置的知识库（quick/fast/deep/auto）
argument-hint: [quick|fast|q|f|deep|d] [可选 topic]
---

用户执行了 `/note $ARGUMENTS`。

立即按 `note-distill` skill 的流程处理：

1. **解析参数** `$ARGUMENTS`：
   - 空 → MODE=auto
   - 首个 token 是 `quick` / `q` / `fast` / `f` → MODE=quick（fast/f 归一化）
   - 首个 token 是 `deep` / `d` → MODE=deep
   - 剩余文本作为 TOPIC_HINT
   - 若没有模式关键词，则全部文本都当 TOPIC_HINT，MODE=auto

2. **加载 note-distill skill**（调用 Skill 工具），然后严格按 SKILL.md 的 Step 1 ~ Step 4 执行：
   - Step 1: 读配置 `~/.config/note-distill/config.json`，缺失按 SKILL.md 指引报错
   - Step 2: 把 MODE 和 TOPIC_HINT 准备好
   - Step 3: spawn fork subagent（`subagent_type="fork"` + `run_in_background=true`），按 SKILL.md 的 prompt 模板生成 prompt，把 SKILL_DIR 填成 Skill 工具载入时看到的 "Base directory for this skill"
   - Step 4: 简短汇报任务已派发，立即回到用户原任务

**绝对禁止**：在主 session 里做任何笔记内容的提炼/摘要/正文写作——那是 fork subagent 的工作。
