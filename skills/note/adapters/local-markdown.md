# Local Markdown Adapter

直接管理本地 markdown 文件，通过**模板文件**控制笔记格式。用户只需维护一个 markdown 模板，无需理解 JSON schema。

## 配置读取

从 `~/.config/note-distill/config.json` 读以下字段：

- `output_dir`：笔记输出目录的绝对路径（必填）
- `subfolder_by_mode.quick` / `subfolder_by_mode.deep`：按模式分子目录（默认 `quick` / `deep`）
- `templates_dir`：用户自定义模板目录（默认 `~/.config/note-distill/templates/`）。可省略，只用内置默认模板。

## 模板解析

### 模板优先级

对于当前 STYLE，按以下顺序查找模板，找到第一个存在的即使用：

1. `<templates_dir>/<style>.md` — 用户风格的模板
2. `<templates_dir>/default.md` — 用户默认模板
3. `{SKILL_DIR}/templates/<style>.md` — 内置风格模板
4. `{SKILL_DIR}/templates/default.md` — 内置默认模板

### 模板变量

模板是标准 markdown 文件，使用 `{{variable}}` 占位符。渲染时必须全部替换，不得保留未替换的占位符。

| 变量 | 类型 | 格式 / 获取方式 |
|---|---|---|
| `{{date}}` | 自动 | `YYYY-MM-DD`，执行 `date +%Y-%m-%d` |
| `{{mode}}` | 自动 | `quick` / `deep` / `auto` |
| `{{style}}` | 自动 | `technical` / `til` / `evergreen` |
| `{{title}}` | AI 生成 | 笔记标题 |
| `{{content}}` | AI 生成 | 笔记正文（按 style 规范写作） |
| `{{domain_tags}}` | AI 生成 | 领域标签，逗号分隔（如 `git, cli`），不超过 4 个 |
| `{{slug}}` | AI 生成 | 文件名 slug，英文、小写、连字符分隔，最多 50 字符 |
| `{{session_id}}` | 自动 | session ID，由主 agent 传入 |
| `{{platform}}` | 自动 | 平台标识（`claude-code` 等），由主 agent 传入 |

### 渲染与写入

1. 按优先级找到模板文件，Read 读取
2. 逐一替换 `{{variable}}` 为实际值
3. 渲染完成后检查：**不得保留任何未替换的 `{{...}}`**，否则报错中止
4. Write 工具写入最终内容

## 文件落点

```
<output_dir>/<OUTPUT_SUBDIR>/{{date}}-{{slug}}.md
```

> `OUTPUT_SUBDIR` 已由主 agent 解析（考虑风格覆盖），直接使用。如 til → `TIL`，evergreen → `Evergreen`，technical → `<subfolder_by_mode[mode]>`。

例：`<output_dir>/quick/2026-05-11-git-squash-commits.md`

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
