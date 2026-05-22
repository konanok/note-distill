---
name: note-config
description: 配置或修改 note-distill 的参数，包括 adapter、输出路径、topic 等
---

用户执行了 `/note-config`。

> 目标：帮用户完成或修改配置。读取旧配置预填默认值。配置完成后自动验证。

## 1. 读取旧配置

Read `~/.config/note-distill/config.json`（全局）和 `./.note-distill.json`（项目级，若存在）。如存在且为合法 JSON，记下各字段值作为默认值。

## 2. 选择配置级别

用 AskUserQuestion 提问，如有旧值则标注为当前：

- **问题**：配置全局还是仅当前项目？
- **选项**：
  - `global` — 写入 `~/.config/note-distill/config.json`（全局生效）
  - `project` — 写入 `./.note-distill.json`（仅当前项目，覆盖全局配置）

若选 `project`，提示：项目级配置只需填写要覆盖的字段，其余字段继承全局配置。

## 3. 选择 adapter

用 AskUserQuestion 提问：

- **问题**：选择笔记写入目标
- **选项**：
  - `local-markdown` — 本地 markdown 文件（推荐）
  - `obsidian` — Obsidian vault

## 4. 根据 adapter 提问路径和链接风格

**若选 local-markdown**：AskUserQuestion 询问 `output_dir`（笔记输出目录的绝对路径）。

**若选 obsidian**：AskUserQuestion 询问 `obsidian_vault_path`（Obsidian vault 的绝对路径）。

旧值作为默认提示。

**链接风格**：自动设置。obsidian → `wikilink`（`[[概念名]]`），local-markdown → `markdown`（`[text](url)`）。

## 5. 默认 topic

用 AskUserQuestion 提问：

- **问题**：默认使用哪个 topic？（不传 topic 名时自动使用）
- **选项**：`til` (推荐) / `adr`

> 用户可随时在 `topics_dir` 下新建 `<name>/` 目录（含 prompt.md + template.md）来扩展 topic。`/note <name>` 会自动识别。

## 6. 写配置

保留旧配置中的 `candidate_selection` 和 `candidate_analyzer`；如果旧配置没有，则写入默认值。

根据步骤 2 的选择写入对应文件：

**global** → `~/.config/note-distill/config.json`（完整配置）：

```json
{
  "adapter": "<adapter>",
  "<路径字段>": "<路径>",
  "link_style": "<markdown|wikilink>",
  "default_topic": "<topic 名>",
  "candidate_selection": {
    "default_behavior": "auto",
    "auto_pick_strategy": "oldest",
    "max_pick_options": 5
  },
  "candidate_analyzer": {
    "provider": "claude",
    "model": "claude-haiku-4-5-20251001",
    "fallback": "heuristic"
  }
}
```

**project** → `./.note-distill.json`（只写要覆盖的字段，最小化）：

```json
{
  "adapter": "<adapter>",
  "<路径字段>": "<路径>"
}
```

> 路径字段：local-markdown → `output_dir`，obsidian → `obsidian_vault_path`。项目级配置只需写覆盖项，其余自动继承全局配置。

## 7. Topic 模板（如首次）

检查 `~/.config/note-distill/topics/` 是否有子目录。如无，从 `{SKILL_DIR}/../note/topics/` 递归复制目录结构。

## 8. 验证

按 `/note-check` 的流程：检查目录、topic、试写测试文件后删除。

全部通过后告知：
> ✅ 配置完成。可以用 `/note` 开始记笔记，随时执行 `/note-config` 修改配置。
