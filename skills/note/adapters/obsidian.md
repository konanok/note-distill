# Obsidian Adapter

写入 Obsidian vault，支持 `[[wikilinks]]` 和 YAML frontmatter。

## 配置读取

从 `~/.config/note-distill/config.json` 读以下字段：

- `obsidian_vault_path`：vault 的绝对路径（必填）
- `subfolder_by_mode.quick` / `subfolder_by_mode.deep`：按模式分子目录（默认 `quick` / `deep`）
- `templates_dir`：用户自定义模板目录（默认 `~/.config/note-distill/templates/`）。可省略。

## 模板解析

和 local-markdown adapter 共用同一套模板系统。详见 `local-markdown.md` 的"模板解析"章节。

## 文件落点

```
<obsidian_vault_path>/<OUTPUT_SUBDIR>/{{date}}-{{slug}}.md
```

> `OUTPUT_SUBDIR` 已由主 agent 解析（考虑风格覆盖），直接使用。如 til → `TIL`，evergreen → `Evergreen`，technical → `<subfolder_by_mode[mode]>`。

例：`<vault>/TIL/2026-05-11-git-squash-commits.md`

如果中间目录不存在，**必须先用 Bash 执行 `mkdir -p "<目标目录>"` 创建**。

## 文件名规则

`{{date}}-{{slug}}.md`：

- `date`：`YYYY-MM-DD`，由 `date +%Y-%m-%d` 获取
- `slug`：从笔记标题生成，英文、小写、连字符分隔、最多 50 字符

**冲突处理**：目标文件已存在 → 内容一致跳过；不一致加 `-2`、`-3` 后缀。

## Wikilinks 处理

在 deep 模式笔记中主动添加 `[[概念名]]`：

- 识别标准术语（如 `[[NUMA]]`、`[[git rebase]]`）
- 每篇 3-8 个为宜
- 不确定 vault 里是否已有也可写，Obsidian 自动处理

## 写入后的确认

1. 用 Read 回读文件前 20 行，确认 frontmatter 正确
2. 确认文件大小 > 200 字节
3. 通过 `SendMessage（recipient="main"）` 回报绝对路径

## 跨平台路径注意

- macOS 上 vault 可能在 `~/Documents/Obsidian/...` 或 iCloud 路径
- 路径含空格时 Bash 命令加引号；Write 工具无需特殊处理
