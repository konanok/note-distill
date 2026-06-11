# note-distill Topic 创建规范

创建自定义 topic 时，须遵守本文档的格式约定。违反硬约束会导致 topic 静默失效——`topic-info.ts` 解析器不会报错，但 frontmatter 数据丢失。

以下规范从出厂 topic（til、investigation、adr、runbook、arch）中提取，是所有 topic 必须遵守的最小公约。

## 1. 文件结构（硬约束）

每个 topic 目录须包含两个文件：

```
<topics_dir>/<name>/
├── prompt.md      # 必须存在，缺少则目录不被识别为 topic
└── template.md    # 必须存在，缺少则 subagent 停止并回报
```

`<name>` 即 canonical name，作为 `/note <name>` 和 alias 解析的 key。

## 2. prompt.md 规范

### 2.1 目录放置

| 级别 | 路径 | 适用场景 |
|---|---|---|
| 用户级（默认） | `~/.config/note-distill/topics/<name>/` | 个人通用 topic，所有项目共享 |
| 项目级 | `./.note-distill/topics/<name>/` | 仅当前项目可见，优先级最高（遮蔽同名用户级/出厂级） |

**默认放用户级**。创建完成后询问用户是否需要移到项目级。

### 2.2 frontmatter 格式（硬约束）

```yaml
---
aliases: [alias1, alias2]
scope: ...
---
```

`topic-info.ts` 的 `parseFrontmatter()` 有严格限制：

- `aliases`：**仅支持内联数组** `aliases: [a, b]`。不支持 YAML 多行列表（写 `aliases:\n  - a` 会被静默忽略）。无别名时写 `aliases: []`，不省略该行。
- `scope`：**仅支持单行**。换行会被截断。无 scope 时写 `scope: `（显式留空），不省略该行。

### 2.3 scope 写法

scope 是 `TOPIC=auto` 时 subagent 路由匹配的唯一依据。须包含：

1. **正向定义**：一句话说清记录什么内容，含特征关键词
2. **排他声明**：用 `→xxx` 指向容易混淆的其他 topic

出厂 scope 示例（参考写法而非复制内容）：

```
# til
scope: 记录碎片知识点：命令用法、API 参数、概念洞察。不记录方案选型（→adr）、架构描述（→arch）、问题排查（→investigation）。

# investigation
scope: 记录问题排查过程：有明确异常现象、有定位动作、能回答根因。不记录架构描述（→arch）、选型对比（→adr）、碎片知识点（→til）。

# adr
scope: 记录技术决策：在 ≥2 个备选方案间做了工程取舍。不记录碎片知识点（→til）、架构描述（→arch）、问题排查（→investigation）。

# runbook
scope: 记录排查操作手册：针对操作不当、数据缺失或参数遗漏导致的问题（系统行为符合程序预期，非代码缺陷），从代码分析或架构理解中推导出诊断步骤和排查路径。与 investigation 的区别——investigation 记录代码缺陷触发的故障并出修复方案，runbook 记录操作流程的排查指引（系统逻辑正确，需要纠正操作而非修代码）。不记录碎片知识点（→til）、选型决策（→adr）、架构设计（→arch）。

# arch
scope: 记录子系统/模块的架构设计：组件关系、数据流、关键设计决策及其理由。不记录单个技术决策（→adr）、问题排查过程（→investigation）、碎片知识点（→til）。
```

### 2.4 标准章节

**必需章节**：

```markdown
## 记录标准（必须**全部**满足）
## 边界与排他
## 写作风格
## 留白纪律
### 占位符必须实际替换（validator 兜底）
```

- **记录标准**：至少 2 条硬条件，全部满足才记录。不满足则退回建议其他 topic。
- **边界与排他**：列出容易混淆的场景及应走的其他 topic。
- **留白纪律**：统一要求"对话未讨论 → 写`（X 未在对话中讨论，待补充）`，不从训练知识补"。**编内容比留白危害大十倍**。
- **占位符替换**：模板所有 `{{...}}` 在最终笔记中必须替换为实际文字。`validate-note.ts` 扫全文 `{{...}}` 残留并 FAIL。

**按需添加**：领域特有的写作指引（如 adr 的"复盘场景特别说明"、investigation 的"可选段何时加/何时不加"）。

完整 `prompt.md` 示例参见出厂 topic：
- `skills/note/topics/til/prompt.md` — 最简结构，适合入门
- `skills/note/topics/investigation/prompt.md` — 含边界排他、写作风格、可选段规则、follow-up 双写
- `skills/note/topics/adr/prompt.md` — 含 status 升级规则、复盘场景处理
- `skills/note/topics/runbook/prompt.md` — 含排查步骤指引、代码线索、指令式写作
- `skills/note/topics/arch/prompt.md` — 最完整示例（组件概览、数据流、设计决策）

## 3. template.md 规范

### 3.1 公共 frontmatter

所有 topic 模板须包含以下 frontmatter（`type` 和 `tags` 中的 topic 名替换为实际值）：

```yaml
---
title: "{{title}}"
type: <TOPIC_NAME>
created: { { datetime } }
updated: { { datetime } }
ai-generated: true
reviewed: false
source: note-distill:{{platform}}:{{session_id}}
tags: [<TOPIC_NAME>, { { domain_tags } }, ai-generated, TODO]
---
```

**重要**：frontmatter 中的 `datetime`、`domain_tags` 占位符写为 `{ { var } }`（加空格），与正文的 `{{var}}`（无空格）区分。`validate-note.ts` 只扫描 `{{...}}` 格式，加空格后的占位符不会被 validator 捕获——subagent 须确保替换。

**额外 frontmatter 字段**：如 `status`、`follow-up`、`deciders` 等 topic 特有字段，插入在 `updated` 之后。出厂 topic 中，adr 的 `status`/`deciders` 等放在 `updated` 与 `ai-generated` 之间，investigation/til 的 `follow-up` 放在 frontmatter 末尾——两种都合法。

### 3.2 必填变量

| 变量 | 替换规则 |
|---|---|
| `{{title}}` | 笔记标题 |
| `{{datetime}}` / `{ { datetime } }` | `YYYY-MM-DD HH:MM:SS` |
| `{{slug}}` | 英文小写连字符 ≤50 字符 |
| `{{platform}}` | `claude-code` / `codebuddy` / `unknown` |
| `{{session_id}}` | 会话 ID |
| `{{domain_tags}}` / `{ { domain_tags } }` | ≤4 个领域标签 |

### 3.3 Section 结构

- **必填 section**：`##` 标题，不含 `（可选）`。validator 检查文本完全一致。**至少 2 个**。
- **可选 section**：标题含 `（可选）`，如 `## 常见误判（可选）`。validator 不强制检查。
- **占位符**：每个 section 配一个 `{{variable}}` 作为 subagent 填充目标。
- **HTML 注释**：`<!-- ... -->` 是给 subagent 的填充指引，不出现在最终笔记中。

可选 section 有两种实现方式：

1. **标题标注 `（可选）`**（til 风格）：section 在模板中以 `## section（可选）` 形式存在，validator 不强制检查。适合固定结构、偶尔不写的 section。
2. **HTML 注释包裹**（investigation 风格）：section 完全不在模板正文中，由 `<!-- 可选：## section ... -->` 注释包裹，subagent 按 prompt.md 的"何时加/何时不加"规则决定是否插入。适合条件性很强、需动态决策的 section。

在 `prompt.md` 中写明省略/插入条件。

完整 `template.md` 示例参见出厂 topic：
- `skills/note/topics/til/template.md` — 最简模板（2 必填 + 可选 section 标注），适合入门
- `skills/note/topics/investigation/template.md` — 含可选 section（HTML 注释包裹）+ `follow-up`
- `skills/note/topics/adr/template.md` — 多必填 section、含 `status` 字段
- `skills/note/topics/runbook/template.md` — 动态步骤数、代码线索表格
- `skills/note/topics/arch/template.md` — 最完整示例（组件概览表、数据流 section）

## 4. 创建后校验

```bash
node --experimental-strip-types skills/note/scripts/topic-info.ts \
  --name <TOPIC_NAME> --topics-dir <topics_dir_parent>
```

`found: true` → 通过。`found: false` → 检查 frontmatter 格式（aliases 多行？scope 换行？）。

同时确认新 topic 的 aliases 不与任何已注册 topic 的 canonical name 或 alias 冲突（运行 `topic-info.ts` 无 `--name` 列出所有 topic 交叉检查）。

## 5. 按需参考

以下特性并非所有 topic 都需要。当自定义 topic 涉及这些需求时，参考对应出厂 topic：

| 需求 | 参考 | 关注点 |
|---|---|---|
| 最简模板参考 | `skills/note/topics/til/` | 2 必填 section + 可选 section 标注 |
| 可选 section 动态插入（investigation 风格） | `skills/note/topics/investigation/` | HTML 注释包裹 + prompt.md "何时加/何时不加" 规则 |
| follow-up 跟进事项 | `skills/note/topics/investigation/` | 判断标准（最多 1 条）、frontmatter + 正文双写要求 |
| status 字段流转（如 proposed → accepted） | `skills/note/topics/adr/` | prompt.md 中的升级判断标准、template.md 中的默认值硬编码 |
| 多备选方案对比 | `skills/note/topics/adr/` | options 占位符拆分 + pros_and_cons 结构 |
| 动态数量的步骤/条目 | `skills/note/topics/runbook/` | 模板中占位步骤数量 + "按需增减" 注释 |
| 代码线索/文件引用表格 | `skills/note/topics/runbook/` | Markdown 表格格式、行号占位规则 |
| 5 Whys 根因链 / 正常 vs 异常路径图 | `skills/note/topics/investigation/` | 根因分析格式、ASCII/mermaid 图约定 |
