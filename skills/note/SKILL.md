---
name: note
description: 把当前会话中的技术方案派发到后台 fork subagent，写入配置的知识库（quick/fast/deep/auto，支持 --style til|technical|evergreen）
argument-hint: [quick|fast|q|f|deep|d] [--style til|technical|evergreen] [可选 topic]
---

用户执行了 `/note $ARGUMENTS`。

## 1. 解析参数

- 空 → MODE=auto
- 首个 token 是 `quick` / `q` / `fast` / `f` → MODE=quick（fast/f 归一化）
- 首个 token 是 `deep` / `d` → MODE=deep
- 若存在 `--style <name>` → STYLE=name，从参数中移除该部分
- 剩余文本作为 TOPIC_HINT
- 若没有模式关键词，则全部非 `--style` 文本都当 TOPIC_HINT，MODE=auto

## 2. 确定风格（STYLE）

按优先级：
1. 命令行 `--style <name>` → 使用该值
2. config `style_overrides.<mode>` → 使用该值（auto 跳过）
3. config `default_style` → 使用该值
4. 兜底 `technical`

合法值：`technical` / `til` / `evergreen`。无效值降级为 `technical` 并提示用户。

**风格强制模式检查**：`til` 强制 quick，`evergreen` 强制 deep。若与 MODE 冲突，以 style 为准，汇报时告知用户。

## 3. 读配置

读取 `~/.config/note-distill/config.json`。

- 文件不存在 → 停下，告知：`⚠️ 首次使用请先执行 /note-config 完成初始化。`
- `adapter` 缺失或为空 → 报错。
- `adapter` 为 `obsidian` → 检查 `obsidian_vault_path` 非空。
- `adapter` 为 `local-markdown` → 检查 `output_dir` 非空。
- 配置正常 → 继续。

## 4. 解析输出路径与平台

**输出子目录（OUTPUT_SUBDIR）**：检查 `{SKILL_DIR}/styles/{STYLE}.md` 是否有 "文件存放" 覆盖规则：
- til → `TIL`
- evergreen → `Evergreen`
- 无覆盖 → `<subfolder_by_mode[mode]>`

**平台（PLATFORM）**：检查环境变量：
- `$CLAUDE_CODE_SESSION_ID` 非空 → `claude-code`
- 否则 → `unknown`

## 5. Spawn fork subagent（后台）

调用 Agent 工具，**必须满足**：
- `subagent_type="general-purpose"` —— 需配合 `CLAUDE_CODE_FORK_SUBAGENT=1`，自动以 fork 模式运行（继承完整对话历史）
- `run_in_background=true` —— 后台跑，主 session 不阻塞
- `description="写笔记"`

> **环境要求**：fork 为实验性功能（Claude Code v2.1.117+），需在 `.claude/settings.local.json` 中设置：
> ```json
> { "env": { "CLAUDE_CODE_FORK_SUBAGENT": "1" } }
> ```
> 或 shell profile 中 `export CLAUDE_CODE_FORK_SUBAGENT=1`。推荐前者（项目级，不污染全局）。若未来该功能正式发布或调整，本配置可能需更新。

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

# 必读文件（按顺序读）
1. ~/.config/note-distill/config.json —— 配置（用户级）
2. {SKILL_DIR}/references/note-writer-protocol.md —— 行为规范
3. {SKILL_DIR}/styles/{STYLE}.md —— 风格规范
4. 根据 MODE（若 STYLE 强制了模式，以 STYLE 为准）读对应模板：
   - quick → {SKILL_DIR}/references/quick-template.md
   - deep  → {SKILL_DIR}/references/depth-template.md
   - auto  → 都读，自己判断后选一个
5. 解析并读取模板文件，按优先级找到第一个存在的：
   - <templates_dir>/<STYLE>.md
   - <templates_dir>/default.md
   - {SKILL_DIR}/templates/<STYLE>.md
   - {SKILL_DIR}/templates/default.md
   其中 `templates_dir` 取自 config.json（默认 `~/.config/note-distill/templates/`）。
   读取后按以下规则替换变量，**未列出的 `{{...}}` 保留原样不替换**：
   | 变量 | 替换为 | 获取方式 |
   |---|---|---|
   | `{{date}}` | `YYYY-MM-DD` 格式的今天日期 | `date +%Y-%m-%d` |
   | `{{mode}}` | quick / deep | 使用**最终确定的模式**（auto 需先解析，style 强制需已应用）|
   | `{{style}}` | technical / til / evergreen | 使用 STYLE 变量值 |
   | `{{title}}` | 笔记标题 | AI 根据内容生成 |
   | `{{content}}` | 笔记正文 | AI 按风格规范写作 |
   | `{{domain_tags}}` | 逗号分隔的领域标签（如 `git, cli`） | AI 从内容推断，不超过 4 个 |
   | `{{slug}}` | 英文 slug，小写、连字符、最多 50 字符 | AI 从标题提取核心关键词 |
   | `{{session_id}}` | session ID | 使用 SESSION_ID 变量值 |
   | `{{platform}}` | 平台标识 | 使用 PLATFORM 变量值 |
   替换完成后，检查渲染结果中**不存在任何未替换的 `{{...}}` 占位符**。若有，报错中止。
   **文件名** = `{date}-{slug}.md`。
6. 根据 config.json 的 adapter 读写入规范：
   - obsidian → {SKILL_DIR}/adapters/obsidian.md
   - local-markdown → {SKILL_DIR}/adapters/local-markdown.md
   
   **输出路径**：`<output_dir>/<OUTPUT_SUBDIR>/<filename>.md`（OUTPUT_SUBDIR 已由主 agent 解析，直接使用，不要再从风格文件中读取路径覆盖）。

# 核心约束
- **以对话历史为准，不要用你的训练数据替代。** 如果对话中用的是方法 A，笔记必须记录方法 A，不能写成方法 B（即使 B 更常见）。你拥有完整对话历史，从历史中提取具体步骤、命令、踩坑记录。
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
