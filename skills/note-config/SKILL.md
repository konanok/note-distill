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

## 5. 候选词分析器

用 AskUserQuestion 提问：

- **问题**：是否开启候选词自动分析？（开启后会在对话结束时自动提取值得记录的知识点，`/note` 时直接使用；关闭则由 `/note` 每次自行从对话上下文中提取）
- **选项**：
  - `开启（推荐）` — 对话结束自动分析，`/note` 更精准
  - `关闭` — 不自动分析，`/note` 每次从对话历史提取素材

记下用户选择 → ANALYZER_ENABLED。

## 6. 写配置

### 6.1 生成用户级配置

若 `~/.config/note-distill/config.json` 不存在，将 `{SKILL_DIR}/config.example.json` 复制到 `~/.config/note-distill/config.json`（删掉所有 `_comment` / `_xxx` 行）。这是用户级默认配置，保证三级回退链第二级不缺。

若已存在，将其与 `{SKILL_DIR}/config.example.json`（删掉 `_comment` / `_xxx` 行）做 deep merge（example 为底座），补充可能缺失的新字段后写回，确保用户级配置始终完整。

### 6.2 写入用户选择

**global** — 更新 `~/.config/note-distill/config.json` 中步骤 3–5 对应的字段。

**project** — 新建 `./.note-distill.json`，写入步骤 3–5 对应的字段（即最小化覆盖）：

```json
{
  "adapter": "<adapter>",
  "<路径字段>": "<路径>",
  "link_style": "<markdown|wikilink>",
  "candidate_analyzer": {
    "enabled": <ANALYZER_ENABLED>
  }
}
```

> 路径字段：local-markdown → `output_dir`，obsidian → `obsidian_vault_path`。`candidate_selection` 等未覆盖字段自动继承用户级配置 + 出厂默认值。

## 7. Topic 模板

出厂 topic（til / adr / design / investigation）随插件安装目录提供，`/note` 按三级回退自动查找，无需手动复制到用户目录。

告知用户：

> 📁 出厂 topic 随插件更新自动生效。如需自定义某个 topic，可从 `{SKILL_DIR}/topics/<name>/` 复制到 `~/.config/note-distill/topics/<name>/` 后修改——用户级副本优先级高于出厂，修改后即遮蔽同名出厂 topic。

## 8. 验证

按 `/note-check` 的流程：检查目录、topic、试写测试文件后删除。

全部通过后告知：

> ✅ 配置完成。可以用 `/note` 开始记笔记，随时执行 `/note-config` 修改配置。
