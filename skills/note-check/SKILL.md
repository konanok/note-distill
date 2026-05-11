---
name: note-check
description: 诊断 note-distill 配置是否正确
---

用户执行了 `/note-check`。

1. 检查 `~/.config/note-distill/config.json` 是否存在：
   - 不存在 → 提示"配置文件未找到，请先执行 `/note-config` 初始化。"，结束。
   - 存在 → 继续。

2. 解析 JSON：
   - 解析失败 → 报错 `config.json 不是合法的 JSON 文件`，结束。
   - 解析成功 → 继续。

3. 根据 `adapter` 字段检查：
   - `local-markdown` → 检查 `output_dir`：为空则报"output_dir 未填写"；不为空则 `mkdir -p` 试建，失败则报"output_dir 不可写"
   - `obsidian` → 检查 `obsidian_vault_path`：为空则报"obsidian_vault_path 未填写"；不为空则检查目录是否存在
   - 其他值 → 报"不支持的 adapter: <值>"

4. 检查 `~/.config/note-distill/templates/` 目录下是否有至少一个 `.md` 文件：
   - 无 → 提示"模板目录为空，建议执行 `/note-config` 重新生成默认模板"

5. 检查 `default_style` 等常用字段是否已配置（缺失仅提示，不报错）

6. 权限检查：尝试 `mkdir -p <output_dir>/quick` 和 `Write` 一个测试文件到该目录：
   - 成功 → 立即删除测试文件，通过
   - 失败 → 提示用户将以下规则添加到 `.claude/settings.local.json`：
     ```
     "Bash(date *)",
     "Bash(mkdir *)",
     "Read(<output_dir>/**)",
     "Write(<output_dir>/**)"
     ```

7. 汇总报告：
   - 全部通过 → ✅ 配置正常。可以使用 `/note` 开始记笔记。
   - 有问题 → 逐项列出问题 + 修复建议
