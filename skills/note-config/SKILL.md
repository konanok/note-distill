---
name: note-config
description: 配置或修改 note-distill 的参数，包括 adapter、输出路径、风格等
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

用 AskUserQuestion 提问，如有旧值则标注为当前：

- **问题**：选择笔记输出目标
- **选项**：
  - `local-markdown` — 本地 markdown 文件（推荐）
  - `obsidian` — Obsidian vault，支持 wikilinks

## 4. 根据 adapter 提问路径

**若选 local-markdown**：AskUserQuestion 询问 `output_dir`（笔记输出目录的绝对路径）。

**若选 obsidian**：AskUserQuestion 询问 `obsidian_vault_path`（Obsidian vault 的绝对路径）。

旧值作为默认提示。

## 5. 默认模板

用 AskUserQuestion 提问，如有旧值则标注为当前：

- **问题**：默认使用哪个模板？（不传模板名时自动使用）
- **选项**：`til` (推荐) / `design` / `technical`

> 用户可随时在 `templates_dir` 下新增 `.md` 文件来扩展更多模板。`/note <name>` 会自动识别。

## 6. 写配置

保留旧配置中的 `candidate_selection` 和 `candidate_analyzer`；如果旧配置没有，则写入默认值：

```json
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
```

根据步骤 2 的选择写入对应文件：

**global** → `~/.config/note-distill/config.json`（完整配置）：

```json
{
  "adapter": "<adapter>",
  "<路径字段>": "<路径>",
  "default_template": "<模板名>",
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

> 路径字段：local-markdown → `output_dir`，obsidian → `obsidian_vault_path`。只写当前 adapter 需要的字段。
> 项目级配置只需写覆盖项，其余自动继承全局配置。用户可手动添加其他字段（如 `default_template`）到项目级配置。

## 7. 模板（如首次）

检查 `~/.config/note-distill/templates/` 是否有 `.md` 文件。如无，从 `{SKILL_DIR}/../note/templates/` 复制所有 `.md` 文件。

## 8. 验证

按 `/note-check` 的流程：检查目录、模板、试写测试文件后删除。

全部通过后告知：
> ✅ 配置完成。可以用 `/note` 开始记笔记，随时执行 `/note-config` 修改配置。
