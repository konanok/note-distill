# Obsidian Adapter

## 配置读取

从 `~/.config/note-distill/config.json` 读以下字段：

- `obsidian_vault_path`：vault 的绝对路径（必填，空值报错）
- `notes_subfolder`：笔记主子文件夹（默认 `Tech`）
- `subfolder_by_mode.quick` / `subfolder_by_mode.deep`：按模式再分子目录（默认 `quick` / `deep`）
- `filename_template`：文件名模板（默认 `{date}-{slug}`）
- `date_format`：日期格式（默认 `YYYY-MM-DD`）。将 moment.js 格式转为 `date` 命令的 `strftime` 格式后使用：`YYYY→%Y`、`MM→%m`、`DD→%d`。例：`YYYY-MM-DD` → `date +%Y-%m-%d`；`YYYYMMDD` → `date +%Y%m%d`。
- `frontmatter_defaults`：合并到笔记 frontmatter 的默认字段

## 文件落点

最终路径：

```
<obsidian_vault_path>/<notes_subfolder>/<subfolder_by_mode[mode]>/<filename>.md
```

例：`<obsidian_vault_path>/Tech/deep/2026-05-09-numa-placement-failure.md`

如果中间目录不存在，**必须先用 Bash 执行 `mkdir -p "<目标目录>"` 创建**。

## 文件写入

使用 **Write 工具**写入文件（非 Bash）——避免 shell 特殊字符问题，路径含空格时也安全。

## 文件名规则

`{date}-{slug}.md`：

- `date`：今天的日期，用 Bash 执行 `date +<strftime_format>` 获取（根据 `date_format` 配置字段转换，默认等价于 `date +%Y-%m-%d`），不要自己算。
- `slug`：从笔记标题生成：
  - 取标题核心名词/动词短语
  - 中文可保留，但空格/标点替换成 `-`
  - 全小写（英文部分）
  - 最多 50 字符
  - 示例：`压缩最近-N-次-git-commit` → `git-squash-commits`；`NUMA 节点放置失败排查` → `numa-placement-failure`。优先用英文 slug，中文笔记标题可保留中文但 slug 建议英文。

**冲突处理**：如果目标文件已存在：

1. 读取已存在的文件，比较内容。
2. 如果内容几乎一样（重复触发），直接跳过，通过 `SendMessage（recipient="main"）` 回报："ℹ️ 笔记已存在且内容一致，跳过: `<path>`"。
3. 如果内容不同，在文件名后加 `-2`、`-3`... 直到不冲突。

## Frontmatter 规范

Obsidian 使用 YAML frontmatter。必须包含字段：

```yaml
---
tags: [auto-note, <domain-tag>, <more-tags>]
source: note-distill
mode: <quick|deep>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
verified: <YYYY-MM-DD | experience-based | partial>
aliases: []
---
```

- `tags`：合并 config 的 `frontmatter_defaults.tags` + 从笔记内容推断的领域标签（如 `git`、`numa`、`python`）。不要超过 6 个。
- `verified` 取值：
  - `YYYY-MM-DD`：完整验证过
  - `partial`：部分验证（笔记里会标注哪些没验证）
  - `experience-based`：纯经验，未做外部验证
- `aliases`：如果笔记标题可能有多种叫法，填别名数组，Obsidian 双链会自动匹配。

## Wikilinks 处理

在 deep 模式笔记中主动添加 `[[概念名]]`：

- 识别标准术语（如 `[[NUMA]]`、`[[git rebase]]`、`[[uWSGI]]`）
- 不要滥用，每个笔记 3-8 个 wikilinks 为宜
- 不确定 vault 里是否已有对应笔记也可以写，Obsidian 会自动处理

## 写入后的确认

写入成功后：

1. 用 Read 工具回读文件前 20 行，确认 frontmatter 没坏。
2. 确认文件大小 > 200 字节（防止写了个空文件）。
3. 通过 `SendMessage（recipient="main"）` 把**绝对路径**回报主 session。

## 跨平台路径注意

- macOS 上 Obsidian vault 可能在 `~/Documents/Obsidian/...` 或 iCloud 路径（`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/...`），都是合法的。
- 路径包含空格时，Bash 命令里必须加引号；Write 工具写文件时不需要特殊处理。
