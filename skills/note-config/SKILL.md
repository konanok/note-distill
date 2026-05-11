---
name: note-config
description: 配置或修改 note-distill 的参数，包括 adapter、输出路径、风格等
---

用户执行了 `/note-config`。

> 目标：帮用户完成或修改配置。读取旧配置预填默认值。配置完成后自动验证。

## 1. 读取旧配置

Read `~/.config/note-distill/config.json`。如存在且为合法 JSON，记下各字段值作为默认值。

## 2. 选择 adapter

用 AskUserQuestion 提问，如有旧值则标注为当前：

- **问题**：选择笔记输出目标
- **选项**：
  - `local-markdown` — 本地 markdown 文件（推荐）
  - `obsidian` — Obsidian vault，支持 wikilinks

## 3. 根据 adapter 提问路径

**若选 local-markdown**：AskUserQuestion 询问 `output_dir`（笔记输出目录的绝对路径）。

**若选 obsidian**：AskUserQuestion 询问 `obsidian_vault_path`（Obsidian vault 的绝对路径）。

旧值作为默认提示。

## 4. 通用配置

AskUserQuestion：

- **问题**：默认笔记风格？
- **选项**：`technical` (推荐) / `til` / `evergreen`

## 5. 写配置

根据用户选择写入 `~/.config/note-distill/config.json`：

```json
{
  "adapter": "<adapter>",
  "<路径字段>": "<路径>",
  "subfolder_by_mode": { "quick": "quick", "deep": "deep" },
  "default_style": "<风格>",
  "style_overrides": { "quick": "til", "deep": "technical" },
  "auto_mode_heuristic": {
    "deep_if_tokens_gt": 2000,
    "deep_if_files_referenced_gt": 2,
    "deep_if_multiple_alternatives_discussed": true
  }
}
```

> 路径字段：local-markdown → `output_dir`，obsidian → `obsidian_vault_path`。只写当前 adapter 需要的字段。

## 6. 模板（如首次）

检查 `~/.config/note-distill/templates/` 是否有 `.md` 文件。如无，从 `{SKILL_DIR}/../note/templates/` 复制所有 `.md` 文件。

## 7. 验证

按 `/note-check` 的流程：检查目录、模板、试写测试文件后删除。

全部通过后告知：
> ✅ 配置完成。请在 `.claude/settings.local.json` 中添加：
> ```json
> { "env": { "CLAUDE_CODE_FORK_SUBAGENT": "1" } }
> ```
> （实验性功能，项目级配置，推荐方式）。然后就可以用 `/note` 开始记笔记。随时执行 `/note-config` 修改配置。
