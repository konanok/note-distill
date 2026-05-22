# Local Markdown Adapter

直接管理本地 markdown 文件，通过**模板文件**控制笔记格式。用户只需维护一个 markdown 模板，无需理解 JSON schema。

## 配置读取

从 config 读以下字段：

- `output_dir`：笔记输出目录的绝对路径（必填）
- `templates_dir`：用户自定义模板目录（默认 `~/.config/note-distill/templates/`）。可省略。

## 模板解析

### 模板优先级

按以下顺序查找，第一个存在的即使用：

1. `<templates_dir>/<TEMPLATE>.md` — 用户模板
2. `{SKILL_DIR}/templates/<TEMPLATE>.md` — 内置模板

`TEMPLATE` 由主 agent 在 spawn prompt 中传入。

### 模板变量

模板使用 `{{variable}}` 占位符。渲染时必须全部替换，不得保留未替换的占位符。

| 变量 | 类型 | 说明 |
|---|---|---|
| `{{date}}` | 自动 | `YYYY-MM-DD`，执行 `date +%Y-%m-%d` |
| `{{template}}` | 自动 | 模板名，由主 agent 传入 |
| `{{title}}` | AI | 笔记标题 |
| `{{domain_tags}}` | AI | 领域标签，逗号分隔（如 `git, cli`），不超过 4 个 |
| `{{slug}}` | AI | 文件名 slug，英文、小写、连字符分隔，最多 50 字符 |
| `{{session_id}}` | 自动 | session ID，由主 agent 传入 |
| `{{platform}}` | 自动 | 平台标识（`claude-code` 等），由主 agent 传入 |
| `{{tldr}}` | AI | TL;DR 内容 |
| `{{background}}` | AI | 背景与问题 |
| `{{principles}}` | AI | 核心原理 |
| `{{solution}}` | AI | 解决方案/方案内容 |
| `{{alternatives}}` | AI | 备选方案与取舍 |
| `{{boundaries}}` | AI | 边界与陷阱 |
| `{{verification}}` | AI | 验证证据 |
| `{{related}}` | AI | 关联条目 |
| `{{scenario}}` | AI | 场景描述 |
| `{{notes}}` | AI | 备注（可为空） |
| `{{core_argument}}` | AI | 核心观点 |
| `{{evidence}}` | AI | 论据与支撑 |
| `{{counterarguments}}` | AI | 边界与反例 |
| `{{extensions}}` | AI | 延伸方向（可为空） |

### 渲染与写入

1. 按优先级找到模板文件，Read 读取
2. 逐一替换 `{{variable}}` 为实际值
3. 渲染完成后检查：**不得保留任何未替换的 `{{...}}`**，否则报错中止
4. 运行 validate-note.ts 校验
5. Write 工具写入最终内容

## 文件落点

```
<output_dir>/{{date}}-{{slug}}.md
```

例：`<output_dir>/2026-05-11-git-squash-commits.md`

如果中间目录不存在，**必须先用 Bash 执行 `mkdir -p "<目标目录>"` 创建**。

## 文件名规则

文件名 = `{{date}}-{{slug}}.md`：

- `date`：`YYYY-MM-DD`，由 `date +%Y-%m-%d` 获取
- `slug`：从笔记标题生成，英文、小写、连字符分隔、最多 50 字符。例如「压缩最近 N 次 git commit」→ `squash-n-git-commits`

**冲突处理**：如目标文件已存在，内容一致跳过；不一致加 `-2`、`-3` 后缀。

## 写入后的确认

1. 用 Read 回读文件前 20 行，确认 frontmatter 正确
2. 确认文件大小 > 200 字节
3. 通过 `SendMessage（recipient="main"）` 回报绝对路径
