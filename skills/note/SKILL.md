---
name: note
description: 把当前会话中的技术方案派发到后台 subagent，优先消费 hook candidates/event window，写入配置的知识库（quick/fast/deep/auto，支持 --style til|technical|evergreen）
argument-hint: [quick|fast|q|f|deep|d] [--style til|technical|evergreen] [可选 topic]
---

用户执行了 `/note $ARGUMENTS`。

## 1. 解析参数

- 空 → MODE=auto
- 首个 token 是 `quick` / `q` / `fast` / `f` → MODE=quick（fast/f 归一化）
- 首个 token 是 `deep` / `d` → MODE=deep
- 若存在 `--style <name>` → STYLE=name，从参数中移除该部分
- 若存在 `--auto` → SELECTION_BEHAVIOR=auto，从参数中移除该 token
- 若存在 `--pick` / `pick` / `select` → SELECTION_BEHAVIOR=pick，从参数中移除该 token
- 若存在 `--all` → SELECTION_BEHAVIOR=all（experimental），从参数中移除该 token
- 剩余文本作为 TOPIC_HINT
- 若没有模式关键词，则全部非 `--style` / selection 参数文本都当 TOPIC_HINT，MODE=auto

## 2. 确定风格（STYLE）

按优先级：
1. 命令行 `--style <name>` → 使用该值
2. config `style_overrides.<mode>` → 使用该值（auto 跳过）
3. config `default_style` → 使用该值
4. 兜底 `technical`

合法值：`technical` / `til` / `evergreen`。无效值降级为 `technical` 并提示用户。

**风格强制模式检查**：`til` 强制 quick，`evergreen` 强制 deep。若与 MODE 冲突，以 style 为准，汇报时告知用户。

## 2.5 确定候选选择行为（SELECTION_BEHAVIOR）

按优先级：
1. 命令行 `--auto` / `--pick` / `pick` / `select` / `--all` → 使用该值
2. config `candidate_selection.default_behavior` → 使用该值
3. 兜底 `auto`

`AUTO_PICK_STRATEGY` 取 config `candidate_selection.auto_pick_strategy`，缺失则 `oldest`。
`MAX_PICK_OPTIONS` 取 config `candidate_selection.max_pick_options`，缺失则 `5`。

合法值：
- `SELECTION_BEHAVIOR`: `auto` / `pick` / `all`
- `AUTO_PICK_STRATEGY`: `oldest` / `newest` / `priority`
- `MAX_PICK_OPTIONS`: 正整数

无效值降级为默认值并提示用户。

## 3. 读配置

按以下优先级合并（后者覆盖前者）：
1. `~/.config/note-distill/config.json`（全局配置）
2. `./.note-distill.json`（项目级配置，若存在）

合并规则：顶层字段浅层覆盖；已知嵌套对象（`candidate_selection`、`candidate_analyzer`、`auto_mode_heuristic`、`subfolder_by_mode`、`style_overrides`）递归合并。

- 全局配置文件不存在 → 停下，告知：`⚠️ 首次使用请先执行 /note-config 完成初始化。`
- 合并后 `adapter` 缺失或为空 → 报错。
- `adapter` 为 `obsidian` → 检查 `obsidian_vault_path` 非空。
- `adapter` 为 `local-markdown` → 检查 `output_dir` 非空。
- 配置正常 → 继续。

## 4. 解析输出路径与平台

**输出子目录（OUTPUT_SUBDIR）**：
- til → `TIL`
- evergreen → `Evergreen`
- 其他 → `<subfolder_by_mode[mode]>`（取自 config）

**平台（PLATFORM）**：检查环境变量：
- `$CLAUDE_CODE_SESSION_ID` 非空 → `claude-code`
- 否则 → `unknown`

**候选知识点与事件日志窗口（可选）**：检查 hook 收集器是否已记录当前 session：
- `DATA_DIR` = `$NOTE_DISTILL_DATA_DIR`（若设置且非空），否则 `~/.local/share/note-distill`
- `CANDIDATE_LOG_PATH` = `<DATA_DIR>/sessions/<SESSION_ID>/note_candidates.jsonl`（若 SESSION_ID 为 `unknown` 则 `unavailable`）
- 若 `CANDIDATE_LOG_PATH` 存在，且 `{SKILL_DIR}/../../hooks/note_distill_hook.ts` 存在，则运行该 helper 提取 pending candidates：`node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts candidates <CANDIDATE_LOG_PATH> --events <EVENT_LOG_PATH> --topic <TOPIC_HINT> --selection <SELECTION_BEHAVIOR> --strategy <AUTO_PICK_STRATEGY> --max-options <MAX_PICK_OPTIONS>`；`TOPIC_HINT` 为空时省略 `--topic`，原样传入 `NOTE_CANDIDATES`
- 若候选文件不存在、helper 不存在、helper 执行失败或输出为空，则 `NOTE_CANDIDATES = unavailable`
- 若 `SELECTION_BEHAVIOR=pick` 且 `NOTE_CANDIDATES` JSON 中包含 `pick_options`：
  1. 在 spawn subagent 前用 AskUserQuestion 询问：`检测到多个候选知识点，要记录哪一条？`
  2. 选项只展示 candidate 的 `title` / `type`，最多 `MAX_PICK_OPTIONS` 条；主 agent 不得总结候选内容。
  3. 用户选择后，将 `NOTE_CANDIDATES` 重写为只包含所选 candidate 的 JSON（保留 `selected_candidate_ids`、`remaining_count`、`remaining_preview`）。
  4. 如果用户取消或未选择，则停止本次 `/note`，不 spawn subagent。
- `EVENT_LOG_PATH` = `<DATA_DIR>/sessions/<SESSION_ID>/events.jsonl`（若 SESSION_ID 为 `unknown` 则 `unavailable`）
- 若 `EVENT_LOG_PATH` 存在，且 `{SKILL_DIR}/../../hooks/note_distill_hook.ts` 存在，则运行 `node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts window <EVENT_LOG_PATH>` 提取窗口，原样传入 `NOTE_EVENT_WINDOW`
- 若事件日志不存在、helper 不存在、helper 执行失败或输出为空，则 `NOTE_EVENT_WINDOW = unavailable`
- 主 agent 不得总结或改写候选知识点或事件窗口；只允许传递 helper 的原始 JSON 输出或 `unavailable`

## 5. Spawn subagent（后台）

根据候选知识点 / 事件窗口是否可用选择路径：

### 5.1 Primary path：显式输入、普通 subagent

当 `NOTE_CANDIDATES` 可用且包含 pending candidates，或 `NOTE_EVENT_WINDOW` 可用时，走 primary path：

- `subagent_type="general-purpose"` —— 普通 subagent，只依赖 prompt 中显式传入的 candidates/window，不要求继承完整主 session
- `run_in_background=true` —— 后台跑，主 session 不阻塞
- `description="写笔记"`

Primary path 的 prompt 必须明确：subagent 不应假设拥有完整主会话历史；主要素材只来自 `NOTE_CANDIDATES` / `NOTE_EVENT_WINDOW`。完整对话历史如果因用户显式配置而存在，也只能用于背景、消歧和验证。

### 5.2 Fallback path：完整历史 fork

仅当 `NOTE_CANDIDATES = unavailable` 且 `NOTE_EVENT_WINDOW = unavailable` 时，允许退回完整历史路径：

- `subagent_type="general-purpose"` —— 若用户显式配置了 `CLAUDE_CODE_FORK_SUBAGENT=1`，可自动以 fork 模式运行（继承完整对话历史）
- `run_in_background=true`
- `description="写笔记"`

> `CLAUDE_CODE_FORK_SUBAGENT=1` 是实验/兼容路径，不是普通用户默认要求。普通用户不需要配置该环境变量；有 candidates/window 时也不应依赖 fork。

**SKILL_DIR**：从 Skill 工具载入时获取的 "Base directory for this skill"（本文件所在目录），写进 prompt。

### Prompt 模板

```
你现在切换身份：不再是当前的开发/技术助手，你是 note-distill subagent。

你的任务：把本次会话中值得记录的技术方案或问题解法，写成一篇笔记并写入配置的知识库。

# 模式与风格
MODE = {quick|deep|auto}
STYLE = {technical|til|evergreen}
TOPIC_HINT = "{用户给的 topic 提示}"
SKILL_DIR = "{主 agent 传入的 SKILL.md 所在绝对目录}"
OUTPUT_SUBDIR = "{主 agent 解析好的输出子目录，如 TIL、Evergreen、笔记/quick}"
PLATFORM = "{claude-code|unknown}"
SESSION_ID = "{当前 session ID，如无法获取则 `unknown`}"
SELECTION_BEHAVIOR = "{auto|pick|all}"
AUTO_PICK_STRATEGY = "{oldest|newest|priority}"
MAX_PICK_OPTIONS = "{正整数}"
CANDIDATE_LOG_PATH = "{候选知识点路径，如不可用则 `unavailable`}"
NOTE_CANDIDATES = "{note_distill_hook.ts candidates 的原始 JSON 输出，如不可用则 `unavailable`}"
EVENT_LOG_PATH = "{事件日志路径，如不可用则 `unavailable`}"
NOTE_EVENT_WINDOW = "{note_distill_hook.ts window 的原始 JSON 输出，如不可用则 `unavailable`}"

# 输入模式与增量范围
本次 `/note` 命令只是触发点，不属于要记录的内容。

按以下优先级确定本次主要内容范围：
1. 如果 NOTE_CANDIDATES 不是 `unavailable` 且包含 pending candidates，当前是 `primary:candidates` 模式。你不应假设拥有完整主会话历史，主要素材只能来自 NOTE_CANDIDATES。NOTE_CANDIDATES 是本模式的 source of truth；不得因为缺少完整主会话历史而要求 fallback 或中止。
2. 否则，如果 NOTE_EVENT_WINDOW 不是 `unavailable`，当前是 `primary:event-window` 模式。你不应假设拥有完整主会话历史，主要素材只能来自 NOTE_EVENT_WINDOW。NOTE_EVENT_WINDOW 是本模式的 source of truth；不得因为缺少完整主会话历史而要求 fallback 或中止。
3. 否则，当前是 `fallback:full-history` 模式，从完整对话历史按下面规则确定增量范围。

如果因为用户显式配置导致 primary 模式也带有完整对话历史，完整历史仍只能用于消歧、验证和补充背景，不得重新选择主要内容范围外的高价值内容。

如果 NOTE_CANDIDATES 中的候选包含 `source_refs`，可使用 `node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts context <candidate-json-path>` 读取候选指向的局部上下文。该步骤只允许读取 source_refs 指向的范围，不得读取完整 transcript 或完整主会话。

仅当 NOTE_CANDIDATES 和 NOTE_EVENT_WINDOW 都为 `unavailable` 时，按以下规则从完整对话历史确定本次处理范围：
1. 在当前这次 `/note` 之前，找到最近一次用户执行的 `/note ...` 命令；边界消息必须是用户消息，且消息文本以 `/note` 开头。
2. 不要把上一条 `/note` 之后的普通用户问题、助手回复或后台回报当作 note 边界。
3. 如果找到了上一条 `/note`，本次只处理“上一条 `/note` 之后、本次 `/note` 之前”的新对话内容。
4. 上一条 `/note` 之前的内容只能作为背景，不得作为主要笔记素材。
5. 如果找不到上一条 `/note`，则处理当前会话中本次 `/note` 之前的全部技术内容。
6. note 边界以用户执行 `/note` 命令的时刻为准，不以后台笔记写入完成时刻为准。
7. 如果处理范围内没有值得记录的新技术内容，按“空内容”回报并结束。

# 增量范围
本次 `/note` 命令只是触发点，不属于要记录的内容。

在识别要记录的内容前，先确定本次处理范围：
1. 在当前这次 `/note` 之前，找到最近一次用户执行的 `/note ...` 命令；边界消息必须是用户消息，且消息文本以 `/note` 开头。
2. 不要把上一条 `/note` 之后的普通用户问题、助手回复或后台回报当作 note 边界。
3. 如果找到了上一条 `/note`，本次只处理“上一条 `/note` 之后、本次 `/note` 之前”的新对话内容。
4. 上一条 `/note` 之前的内容只能作为背景，不得作为主要笔记素材。
5. 如果找不到上一条 `/note`，则处理当前会话中本次 `/note` 之前的全部技术内容。
6. note 边界以用户执行 `/note` 命令的时刻为准，不以后台笔记写入完成时刻为准。
7. 如果处理范围内没有值得记录的新技术内容，按“空内容”回报并结束。

# 必读文件（按顺序读）
1. 运行 `node --experimental-strip-types {SKILL_DIR}/../../hooks/note_distill_hook.ts merge-config` 获取合并后的配置（全局 + 项目级）
2. {SKILL_DIR}/references/note-writer-protocol.md —— 行为规范
3. {SKILL_DIR}/styles/{STYLE}.md —— 风格规范（写作哲学、section 指导、反模式）
4. 按以下优先级找到模板文件（第一个存在的即使用）：
   - <templates_dir>/<STYLE>-<MODE>.md
   - <templates_dir>/<STYLE>.md
   - {SKILL_DIR}/templates/<STYLE>-<MODE>.md
   - {SKILL_DIR}/templates/<STYLE>.md
   其中 `templates_dir` 取自 config.json（默认 `~/.config/note-distill/templates/`），MODE 为最终确定的模式（auto 已解析，style 强制已应用）。
   模板文件是**完整的笔记骨架**，包含 frontmatter 结构 + 所有 section 标题 + `{{variable}}` 占位符。你的工作是**填充模板变量**，不是自行组织笔记结构。
   读取后按以下规则替换变量，**未列出的 `{{...}}` 保留原样不替换**：
   | 变量 | 替换为 | 获取方式 |
   |---|---|---|
   | `{{date}}` | `YYYY-MM-DD` 格式的今天日期 | `date +%Y-%m-%d` |
   | `{{mode}}` | quick / deep | 使用**最终确定的模式** |
   | `{{style}}` | technical / til / evergreen | 使用 STYLE 变量值 |
   | `{{title}}` | 笔记标题 | AI 根据内容生成 |
   | `{{domain_tags}}` | 逗号分隔的领域标签（如 `git, cli`） | AI 从内容推断，不超过 4 个 |
   | `{{slug}}` | 英文 slug，小写、连字符、最多 50 字符 | AI 从标题提取核心关键词 |
   | `{{session_id}}` | session ID | 使用 SESSION_ID 变量值 |
   | `{{platform}}` | 平台标识 | 使用 PLATFORM 变量值 |
   | `{{tldr}}` | TL;DR 内容 | AI 生成，3-5 句话 |
   | `{{background}}` | 背景与问题 | AI 生成 |
   | `{{principles}}` | 核心原理 | AI 生成 |
   | `{{solution}}` | 解决方案/方案内容 | AI 生成 |
   | `{{alternatives}}` | 备选方案与取舍 | AI 生成（deep 模式） |
   | `{{boundaries}}` | 边界与陷阱 | AI 生成（deep 模式） |
   | `{{verification}}` | 验证证据 | AI 生成（deep 模式） |
   | `{{related}}` | 关联条目 | AI 生成 |
   | `{{scenario}}` | 场景描述 | AI 生成（quick 模式） |
   | `{{notes}}` | 备注 | AI 生成（quick 模式，可为空） |
   | `{{upgrade_to}}` | technical / evergreen / null | AI 判断 TIL 知识点适合升级方向 |
   | `{{core_argument}}` | 核心观点 | AI 生成（evergreen） |
   | `{{evidence}}` | 论据与支撑 | AI 生成（evergreen） |
   | `{{counterarguments}}` | 边界与反例 | AI 生成（evergreen） |
   | `{{deep_dive}}` | 值得深入？ | AI 生成（til，可为空） |
   替换完成后，检查渲染结果中**不存在任何未替换的 `{{...}}` 占位符**。若有，报错中止。
   **文件名** = `{date}-{slug}.md`。
5. 生成完整笔记后，运行校验：
   ```bash
   node --experimental-strip-types {SKILL_DIR}/../../hooks/validate-note.ts <note-file> --template <template-file>
   ```
   - PASS → 继续写入
   - WARN → 自行判断是否修改，然后继续
   - FAIL → 根据失败项修改笔记，最多重试 3 轮
6. 根据 merge-config 输出的 config 中 adapter 字段读写入规范：
   - obsidian → {SKILL_DIR}/adapters/obsidian.md
   - local-markdown → {SKILL_DIR}/adapters/local-markdown.md
   
   **输出路径**：`<output_dir>/<OUTPUT_SUBDIR>/<filename>.md`（OUTPUT_SUBDIR 已由主 agent 解析，直接使用，不要再从风格文件中读取路径覆盖）。

# 核心约束
- **以本次显式输入范围为准，不要用你的训练数据替代。** 如果 NOTE_CANDIDATES 可用，以 pending candidates 为主要素材；否则如果 NOTE_EVENT_WINDOW 可用，以其中的事件窗口为主要素材；否则以增量范围内的对话历史为准。如果输入中用的是方法 A，笔记必须记录方法 A，不能写成方法 B（即使 B 更常见）。不要假设 primary 模式拥有完整主会话历史；也不得把“缺少完整主会话历史”视为失败。需要验证时使用 candidates/window 中的 evidence、文件路径、命令或外部资料；即使完整历史存在，范围外内容也只能用于背景、消歧和验证。
- 按模板结构重新组织，产出有深度的笔记。严禁流水账式转述。
- **涉及官方文档、API 规范或可查证的事实，必须在笔记中附上来源 URL。** 不写"查阅官方文档"这种模糊引用，必须贴具体链接。
- 风格文件中的规则优先于模板默认结构，风格文件若强制了模式（如 til 强制 quick），必须遵守。
- 按 note-writer-protocol.md 的验证规范自主选择验证手段。
- 按对应 adapter 的规范写入文件，完成后通过 SendMessage（recipient="main"）把笔记绝对路径发回主 session。

# 开始
现在，按上述流程执行。
```

## 6. 汇报

spawn 成功后回复：

> 📝 笔记任务已派发到后台（模式: {mode}，风格: {style}）。完成后会通知你。

立即回到用户原任务。

## 禁止事项

- ❌ 不要在主 agent 里做摘要/提炼
- ❌ 不要前台跑（`run_in_background=false`）
- ❌ 不要把路径硬编码，一律从 config 读
