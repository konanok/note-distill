---
name: note
description: 后台 subagent 将会话内容按 topic 整理为结构化笔记，写入知识库。出厂 til、adr、design，支持用户自定义 topic。
argument-hint: [til|adr|design] [可选描述]
---

用户执行了 `/note $ARGUMENTS`。

## 1. 解析参数

首 token 匹配已知 topic 名 → TOPIC=该 token，其余为 TOPIC_HINT。不匹配 → TOPIC=config 的 `default_topic`（缺省 `til`），全部为 TOPIC_HINT。已知 topic 名 = 项目级（`./.note-distill/topics/`）> 用户级（`topics_dir`）> 出厂（`{SKILL_DIR}/topics/`）三级目录下的子目录名合集。

若含 `--auto` / `--pick` / `pick` / `select` / `--all` → 移除，对应设置 SELECTION_BEHAVIOR。缺省取 config `candidate_selection.default_behavior`（兜底 `auto`）。AUTO_PICK_STRATEGY 取 config（兜底 `oldest`），MAX_PICK_OPTIONS 取 config（兜底 `5`）。非法值降级为默认值并提示。

## 2. 读配置

合并 `~/.config/note-distill/config.json` + `./.note-distill.json`（可选）。`candidate_selection`、`candidate_analyzer` 递归合并，其余浅覆盖。

- 全局配置不存在 → 停止：`⚠️ 首次使用请先执行 /note-config 完成初始化。`
- `adapter` 为空 → 报错
- 获取 OUTPUT_DIR：`adapter=obsidian` → 取 `obsidian_vault_path`；否则取 `output_dir`。为空则报错

## 3. 确定 COVERAGE 和候选词选择

> 设计原则：主 agent 只注入 subagent 无法自行推断的标量参数（TOPIC、TOPIC_HINT、SKILL_DIR、COVERAGE、SOURCE_PATH、SELECTED_CANDIDATE_IDS）。候选词和窗口的详细数据由 subagent 自行运行 candidates/window 命令获取——主 agent 不搬运 JSON blob。

**SESSION_ID / PLATFORM 判断**（三级）：
1. `$CLAUDE_CODE_SESSION_ID` 非空 → SESSION_ID=该值，PLATFORM=`claude-code`
2. 运行 `node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts find-session --cwd <当前工作目录>` → 从 JSON 取 SESSION_ID 和 PLATFORM
3. 以上均无 → SESSION_ID=`unknown`，PLATFORM=`unknown`

SESSION_ID 非 `unknown` 且 helper 存在时，运行 window 命令确定 COVERAGE：

```
node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts window <EVENT_LOG_PATH>
```

EVENT_LOG_PATH = `<DATA_DIR>/sessions/<SESSION_ID>/events.jsonl`，DATA_DIR = `$NOTE_DISTILL_DATA_DIR` 或 `~/.local/share/note-distill`。helper 不存在或执行失败 → COVERAGE = `empty`。

**COVERAGE**：从 window 输出的 `coverage` 字段取。可能值：
- `full` — hook 在主会话开始时就在线，记录完整
- `partial` — hook 中途接入（events.jsonl 第一条 UserPromptSubmit 就是 `/note`），先前对话未被捕获
- `empty` — events.jsonl 为空或不存在

**若 SELECTION_BEHAVIOR=pick**，额外运行 candidates 命令获取用户选项：

```
node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts candidates <CANDIDATE_LOG_PATH> \
  --events <EVENT_LOG_PATH> \
  [--topic <TOPIC_HINT>] \
  --selection pick --strategy <AUTO_PICK_STRATEGY> --max-options <MAX_PICK_OPTIONS>
```

若输出含 `pick_options`：
1. AskUserQuestion："检测到多个候选知识点，要记录哪一条？"（选项只展示 title/type，≤MAX_PICK_OPTIONS 条）
2. 用户选择 → 记录 `SELECTED_CANDIDATE_IDS = <所选 candidate 的 id>`
3. 取消 → 停止，不 spawn

否则 SELECTED_CANDIDATE_IDS = `none`。

非 pick 模式时 SELECTED_CANDIDATE_IDS = `none`。

## 4. Spawn subagent

**路径选择**（四态）：

| 条件 | SOURCE_PATH |
|---|---|
| COVERAGE=`full` 且 window 输出含事件数据 | `primary` |
| COVERAGE=`full` 但 window 输出无事件数据 | `fallback` |
| COVERAGE=`partial` | `fallback` |
| COVERAGE=`empty` 或 helper 不存在 | `fallback` |

> COVERAGE=`partial` 时，即使 candidates 命令返回了数据，subagent 也必须走 fallback。partial 数据不可信——hook 中途接入，已捕获片段不代表完整对话。主 agent 通过 SOURCE_PATH=fallback 指示这一决策。

**Spawn 机制按平台选择**：

| 平台 | spawn 方式 | 参数 |
|---|---|---|
| Claude Code | `subagent_type="general-purpose"` | `run_in_background=true`, `description="写笔记"` |
| CodeBuddy | Task 工具 | `subagent_name="general-purpose"`, `description="写笔记"`, prompt 中注入完整 spawn prompt |

> CodeBuddy 的 Task 工具中，主 agent 需将 spawn prompt 全文注入 Task 的 prompt 参数。**禁止主 agent 对对话历史做摘要或提炼**——subagent 自行从 EVENT_LOG_PATH 读取原文并判断内容取舍。

SKILL_DIR = Skill 工具返回的 "Base directory for this skill"。

### Prompt

```
你是 note-distill subagent。将会话中值得记录的内容按 topic 规范写成笔记。

输入：
  TOPIC = {name}              TOPIC_HINT = "{text}"
  SKILL_DIR = {dir}
  COVERAGE = {full|partial|empty}
  SOURCE_PATH = {primary|fallback}
  SELECTED_CANDIDATE_IDS = {csv|none}

流程：
1. 获取配置：`node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts merge-config`

2. 确定平台与会话（自行发现，无需主 agent 注入）：
   a. 检查 `$CLAUDE_CODE_SESSION_ID` → 若非空，SESSION_ID=该值，PLATFORM=`claude-code`
   b. 否则运行 `node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts find-session --cwd <当前工作目录>` → 从 JSON 取 SESSION_ID 和 PLATFORM
   c. 均无 → SESSION_ID=`unknown`，PLATFORM=`unknown`
   d. 构造路径：DATA_DIR = `$NOTE_DISTILL_DATA_DIR` 或 `~/.local/share/note-distill`
      EVENT_LOG_PATH = `<DATA_DIR>/sessions/<SESSION_ID>/events.jsonl`
      CANDIDATE_LOG_PATH = `<DATA_DIR>/sessions/<SESSION_ID>/note_candidates.jsonl`

3. 读 {SKILL_DIR}/references/note-writer-protocol.md，严格遵守

4. 按 SOURCE_PATH 获取素材：
   - SOURCE_PATH=primary：
     a. `node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts window <EVENT_LOG_PATH>`
     b. `node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts candidates <CANDIDATE_LOG_PATH> --events <EVENT_LOG_PATH> [--topic <TOPIC_HINT>] --selection auto --strategy oldest`
     若 SELECTED_CANDIDATE_IDS 非 `none`，仅使用指定 ID 的候选词（用户已通过 --pick 选择）
   - SOURCE_PATH=fallback：从 EVENT_LOG_PATH 读取对话内容（见下方 Fallback 模式专用指令）

5. 按优先级查找 topic 目录（项目 .note-distill/topics/ > 用户 topics_dir > 出厂 SKILL_DIR/topics/），
   读 prompt.md（领域判断 + 写作要求）和 template.md（输出骨架）

6. 按 protocol §1 识别内容范围，以 prompt.md 的标准判断是否值得记录

7. 填充 template.md 中的所有 {{variable}}，不得保留未替换的占位符。
   {{datetime}} = 当前时间，格式 `YYYY-MM-DD HH:MM:SS`（通过 shell 命令或运行时 API 获取）；{{slug}} = 英文小写连字符 ≤50 字符；{{domain_tags}} ≤4 个

8. 校验：`node --experimental-strip-types {SKILL_DIR}/../../hooks/validate-note.ts <note> --template <tpl>`
   FAIL 则修改重试 ≤3 轮

9. 写入：按 protocol §4 的写入规范

10. 标记 consumed + SendMessage(recipient="main") 回报

【Fallback 模式专用指令】（仅当 SOURCE_PATH=fallback 时启用）
素材来源为 EVENT_LOG_PATH：
- 直接读取 EVENT_LOG_PATH（events.jsonl），从中提取用户 prompt + 助手回复作为写作素材
- 若文件不存在，明确回报：`⚠️ 无法定位 events.jsonl，无法完成笔记。`
- 按 protocol §1 的增量范围规则确定本次记录范围
- 跳过 mark-consumed 步骤（无 candidate ID 可标记）

约束：
- protocol 的工作流和底线约束不可被 prompt.md 覆盖
- 素材优先级：candidates > event window > EVENT_LOG_PATH
- COVERAGE=partial 时即使自行运行 window 命令得到数据，也不得作为唯一素材使用
- 按模板重组，严禁流水账转述
- 官方文档/API 附来源 URL
```

## 5. 汇报

spawn 后回复：`📝 笔记任务已派发到后台（topic: {topic}）。完成后会通知你。`

禁止：主 agent 摘要/提炼、前台跑、硬编码路径。
