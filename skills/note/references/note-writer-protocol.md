# note-writer 写入协议

本文件定义笔记的**写入方式和 adapter 调度逻辑**，所有 topic 共用。

## 输出路径

`<OUTPUT_DIR>/{date}-{slug}.md`

- `OUTPUT_DIR`：adapter=obsidian → `obsidian_vault_path`；否则 → `output_dir`。均从 merge-config 输出获取。
- `{date}`：日期部分 `YYYY-MM-DD`（通过 shell 命令或运行时 API 获取）
- `{slug}`：从标题提取，英文小写连字符 ≤50 字符

## Adapter 调度

根据 merge-config 输出的 `adapter` 字段选择写入方式：

| adapter | 链接风格 | 扩展脚本 | 降级方式 |
|---------|---------|---------|---------|
| local-markdown | `[text](url)` | `write-local-markdown.ts`（如有） | mkdir + Write |
| obsidian | `[[wikilink]]`（3-8 个/篇） | `write-obsidian.ts`（如有） | mkdir + Write |

扩展脚本位置：`$SKILL_DIR/../../hooks/write-<adapter>.ts`

### 写入步骤

1. 若扩展脚本存在 → 优先用它写入（通过 Bash 调用），失败则降级到步骤 2
2. 否则：
   - `mkdir -p <目标目录>` 创建目录
   - Write 工具写入完整 Markdown
   - 文件已存在 → Read 比较内容：一致则跳过（幂等），不一致加 `-2`/`-3` 后缀

### 写入后确认

1. Read 回读前 20 行，确认 frontmatter 正确
2. 确认文件大小 > 200 字节
3. 若内容含 wikilink → 确认语法正确（`[[概念名]]` 或 `[[概念名|别名]]`）

## 新增 adapter

要支持新的写入目标，在 `hooks/` 下添加 `write-<adapter>.ts` 脚本，并在上表中注册。脚本通过 Bash 调用，subagent 无需额外权限声明。
