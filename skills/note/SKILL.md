---
name: note
description: 后台 subagent 将会话内容按 topic 整理为结构化笔记，写入知识库。未指定 topic 时由 subagent 自动判断；出厂 til、adr、arch(design)、investigation(diag)、runbook(playbook)，支持用户自定义 topic 和别名。
argument-hint: [til|adr|arch|design|investigation|diag|runbook|playbook|troubleshooting] [可选描述]
---

用户执行了 `/note $ARGUMENTS`。SKILL_DIR = Skill 工具返回的 "Base directory for this skill"。

> 运行脚本：本项目所有 `.ts` 脚本均以 `node --experimental-strip-types` 运行。下文仅写路径和参数。

## 1. 解析参数

首词 → TOPIC，其余 → TOPIC_HINT。首词为空 → TOPIC=`auto`。

`--auto` / `--pick` / `pick` / `select` / `--all` → 移除，设为 SELECTION_BEHAVIOR。
缺省取 `candidate_selection.default_behavior`（兜底 `auto`），非法值降级并提示。
AUTO_PICK_STRATEGY 兜底 `oldest`，MAX_PICK_OPTIONS 兜底 `5`。

## 2. 若 SELECTION_BEHAVIOR=pick

读 `topics_dir`：`{SKILL_DIR}/scripts/merge-config.ts`

确定 SESSION_ID：
1. `$CLAUDE_CODE_SESSION_ID` 非空 → SESSION_ID=该值，PLATFORM=`claude-code`
2. `{SKILL_DIR}/scripts/find-session.ts --cwd .`
3. 均无 → SESSION_ID=`unknown`

若 SESSION_ID 非 `unknown`：
```
{SKILL_DIR}/scripts/window.ts --session-id <SESSION_ID>
```
若 COVERAGE != `empty`：
```
{SKILL_DIR}/scripts/candidates.ts --session-id <SESSION_ID> \
  [--topic <TOPIC_HINT>] \
  --selection pick --strategy <AUTO_PICK_STRATEGY> --max-options <MAX_PICK_OPTIONS>
```
若含 `pick_options` → AskUserQuestion："检测到多个候选知识点，要记录哪一条？"（仅展 title/type，≤MAX_PICK_OPTIONS）→ 选择 → SELECTED_CANDIDATE_IDS=<所选 id>；取消 → 停止。

否则 SELECTED_CANDIDATE_IDS=`none`。

## 3. Spawn note-writer

读 `{SKILL_DIR}/scripts/merge-config.ts --platform <PLATFORM>`（若 PLATFORM 已知）→ 取 `subagent_resolved_model`。否则 MODEL 兜底 `haiku`。

| 平台 | 机制 | 参数 |
|---|---|---|
| Claude Code | `subagent_type="note-writer"` | `model=<MODEL>`, `run_in_background=true` |
| CodeBuddy | Task 工具 | `subagent_name="note-writer"`, `model=<MODEL>` |

description = `记{TOPIC}笔记`（TOPIC=auto → `"记笔记"`）

注入：
```
TOPIC = {首词|auto}
TOPIC_HINT = "{其余文本}"
SELECTED_CANDIDATE_IDS = {csv|none}
SKILL_DIR = {SKILL_DIR}
```

## 4. 汇报

`📝 笔记任务已派发到后台（topic: {TOPIC，auto→"自动判断"}）。完成后会通知你。`
