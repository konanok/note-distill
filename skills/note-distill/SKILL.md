---
name: note-distill
description: 用 fork subagent 在后台把当前对话中的技术方案写成笔记，支持 quick/deep 两种模式，写入目标由 adapter 配置决定（v0.0.1 仅支持 obsidian）。Use when the user types /note, /note quick, /note fast, /note deep, /note q, /note f, /note d, or asks to "记笔记"、"把这个方案记下来"、"归档到 obsidian".
version: 0.0.1
---

# Note Distill —— 后台笔记提炼器

## 触发条件

用户输入以下任一命令时，立即按本 skill 执行：

- `/note` 或 `/note <topic>` —— 自动判断模式
- `/note quick` / `/note q` / `/note fast` / `/note f` —— 快速记录模式（`fast` 是 `quick` 的别名）
- `/note deep` / `/note d` —— 深度探索模式
- 自然语言："把这个方案记到 obsidian"、"记笔记"、"归档这个讨论"

## 核心原则

**本 skill 的唯一职责是：立即 spawn 一个 fork subagent 到后台，让主 session 不被打断。**

主 agent 执行本 skill 时必须遵守：

1. **零摘要、零加工**：不要尝试在主 session 里提炼内容。fork subagent 会拿到完整对话历史，由它自己判断。
2. **配置先行**：spawn 前必须读配置；配置缺失立即在主 session 报错让用户补齐。
3. **立即返回**：spawn 完成后一句话汇报任务已派发，主 agent 继续原任务。

## 执行流程（主 agent 端）

### Step 1：读配置

读取 `~/.config/note-distill/config.json`。

- 文件不存在 → 先 `mkdir -p ~/.config/note-distill`，再从 `{SKILL_DIR}/config.example.json` 复制一份到 `~/.config/note-distill/config.json`（`SKILL_DIR` 是 Skill 工具载入本 skill 时给出的 "Base directory" 值，此时已知），然后停下，在主 session 告知用户：
  > ⚠️ 首次使用 /note，请先填写 `~/.config/note-distill/config.json` 里的相关字段（至少填写 `adapter` 及对应的目标路径），然后重试。

- 文件存在但 `adapter` 字段缺失或为空字符串 → 报错提示用户补填。

- `adapter` 为 `obsidian` 时，额外检查 `obsidian_vault_path` 字段是否缺失或为空字符串 → 同样报错提示。

- 配置正常 → 继续 Step 2。

### Step 2：确定模式

根据用户输入确定模式：

| 输入 | 模式 |
|---|---|
| `/note quick`、`/note q`、`/note fast`、`/note f` | `quick`（`fast`/`f` 是别名，统一归一化为 `quick`） |
| `/note deep`、`/note d` | `deep` |
| `/note`、`/note <topic>`（无 quick/fast/deep 关键词） | `auto`（subagent 自己判断） |

提取可选 topic 提示（命令后跟着的自由文本）。

**归一化规则**：spawn subagent 时传的 `MODE` 值必须是 `quick` / `deep` / `auto` 三者之一。`fast` 和 `f` 在主 agent 端就要归一化成 `quick`，不要把 `fast` 传给 subagent——保持内部语义统一。

### Step 3：Spawn fork subagent（后台）

调用 Task 工具，**必须满足**：

- `subagent_type="fork"` —— 继承完整对话历史
- `run_in_background=true` —— 后台跑，主 session 不阻塞
- `description="写笔记"`
- `prompt` 按下面的模板生成

在生成 prompt 前，**主 agent 必须记下当前 SKILL.md 的绝对路径所在目录**（从 Skill 工具载入时能看到 "Base directory for this skill"，把这个值存为 `SKILL_DIR`），然后把它写进 prompt。这样 subagent 无论 plugin 被装在哪都能准确找到引用文件。

#### Prompt 模板（复制后填充变量）

```
你现在切换身份：不再是当前的开发/技术助手，你是 note-distill subagent。

你的任务：把本次会话中值得记录的技术方案或问题解法，写成一篇笔记并写入配置的知识库。

# 模式
MODE = {quick|deep|auto}
TOPIC_HINT = "{用户给的 topic 提示，可为空}"
SKILL_DIR = "{主 agent 传入的 SKILL.md 所在绝对目录}"

# 必读文件（按顺序读）
1. ~/.config/note-distill/config.json —— 配置（用户级，不在 SKILL_DIR 内）
2. {SKILL_DIR}/references/note-writer-protocol.md —— 行为规范
3. 根据 MODE 读对应模板：
   - quick → {SKILL_DIR}/references/quick-template.md
   - deep  → {SKILL_DIR}/references/depth-template.md
   - auto  → 都读，自己判断后选一个
4. 根据 config.json 的 adapter 字段读对应写入规范：
   - obsidian → {SKILL_DIR}/adapters/obsidian.md

# 核心约束
- 你拥有完整对话历史，必须亲自从历史中识别"值得记录"的内容，不要依赖摘要。
- 严禁直接转述对话。按模板结构重新组织，产出有深度的笔记（deep 模式下尤其）。
- 按 note-writer-protocol.md 的验证规范自主选择验证手段。
- 按对应 adapter 的规范写入文件，完成后通过 SendMessage（recipient="main"）把笔记绝对路径发回主 session。

# 开始
现在，按上述流程执行。
```

### Step 4：汇报

spawn 成功后在主 session 回复一句（保持简短）：

> 📝 笔记任务已派发到后台（模式: {mode}）。完成后会通知你。

然后立即回到用户原任务。

## 禁止事项

- ❌ 不要在主 agent 里做摘要/提炼。
- ❌ 不要用 `subagent_type="general-purpose"`——那是独立上下文，拿不到对话历史。
- ❌ 不要前台跑（`run_in_background=false`）——会阻塞主 session。
- ❌ 不要把写入目标路径硬编码，一律从 config 读。
