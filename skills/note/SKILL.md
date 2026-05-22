---
name: note
description: 后台 subagent 将会话内容按 topic 整理为结构化笔记，写入知识库。出厂 til、adr，支持用户自定义 topic。
argument-hint: [til|adr] [可选描述]
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

## 3. 提取候选与事件窗口

| 变量 | 来源 |
|---|---|
| PLATFORM | `$CLAUDE_CODE_SESSION_ID` 非空 → `claude-code`，否则 `unknown` |
| DATA_DIR | `$NOTE_DISTILL_DATA_DIR` 或 `~/.local/share/note-distill` |
| CANDIDATE_LOG_PATH | `<DATA_DIR>/sessions/<SESSION_ID>/note_candidates.jsonl` |
| EVENT_LOG_PATH | `<DATA_DIR>/sessions/<SESSION_ID>/events.jsonl` |

SESSION_ID 非 `unknown` 且 helper（`{SKILL_DIR}/../../hooks/note_distill_hook.ts`）存在时：

```
# candidates
node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts candidates <CANDIDATE_LOG_PATH> \
  --events <EVENT_LOG_PATH> \
  [--topic <TOPIC_HINT>] \
  --selection <SELECTION_BEHAVIOR> --strategy <AUTO_PICK_STRATEGY> --max-options <MAX_PICK_OPTIONS>
```
TOPIC_HINT 为空时省略 `--topic`。输出 → NOTE_CANDIDATES。

```
# window
node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts window <EVENT_LOG_PATH>
```
输出 → NOTE_EVENT_WINDOW。

helper 不存在、执行失败或输出为空 → 对应变量 = `unavailable`。

若 SELECTION_BEHAVIOR=pick 且 NOTE_CANDIDATES 含 `pick_options`：
1. AskUserQuestion："检测到多个候选知识点，要记录哪一条？"（选项只展示 title/type，≤MAX_PICK_OPTIONS 条）
2. 用户选择 → 重写 NOTE_CANDIDATES 为仅含所选 candidate 的 JSON
3. 取消 → 停止，不 spawn

**禁止**主 agent 总结或改写 NOTE_CANDIDATES / NOTE_EVENT_WINDOW，只传原始 JSON 或 `unavailable`。

## 4. Spawn subagent

**路径选择**：NOTE_CANDIDATES 或 NOTE_EVENT_WINDOW 可用 → primary；均 `unavailable` → fallback（实验路径，需 `CLAUDE_CODE_FORK_SUBAGENT=1`）。

均为 `subagent_type="general-purpose"`, `run_in_background=true`, `description="写笔记"`。

SKILL_DIR = Skill 工具返回的 "Base directory for this skill"。

### Prompt

```
你是 note-distill subagent。将会话中值得记录的内容按 topic 规范写成笔记。

输入：
  TOPIC = {name}              TOPIC_HINT = "{text}"
  SKILL_DIR = {dir}           PLATFORM = {claude-code|unknown}
  SESSION_ID = {id}
  CANDIDATE_LOG_PATH = {path|unavailable}
  NOTE_CANDIDATES = {json|unavailable}
  EVENT_LOG_PATH = {path|unavailable}
  NOTE_EVENT_WINDOW = {json|unavailable}

流程：
1. 获取配置：`node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts merge-config`
2. 读 {SKILL_DIR}/references/note-writer-protocol.md，严格遵守
3. 按优先级查找 topic 目录（项目 .note-distill/topics/ > 用户 topics_dir > 出厂 SKILL_DIR/topics/），
   读 prompt.md（领域判断 + 写作要求）和 template.md（输出骨架）
4. 按 protocol §1 识别内容范围，以 prompt.md 的标准判断是否值得记录
5. 填充 template.md 中的所有 {{variable}}，不得保留未替换的占位符。
   {{date}} = `date +%Y-%m-%d` 输出；{{slug}} = 英文小写连字符 ≤50 字符；{{domain_tags}} ≤4 个
6. 校验：`node --experimental-strip-types {SKILL_DIR}/../../hooks/validate-note.ts <note> --template <tpl>`
   FAIL 则修改重试 ≤3 轮
7. 写入：按 protocol §4 的写入规范
8. 标记 consumed + SendMessage(recipient="main") 回报

约束：
- protocol 的工作流和底线约束不可被 prompt.md 覆盖
- 素材优先级：candidates > event window > 对话历史
- 按模板重组，严禁流水账转述
- 官方文档/API 附来源 URL
```

## 5. 汇报

spawn 后回复：`📝 笔记任务已派发到后台（topic: {topic}）。完成后会通知你。`

禁止：主 agent 摘要/提炼、前台跑、硬编码路径。
