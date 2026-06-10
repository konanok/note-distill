---
name: note-check
description: 诊断 note-distill 配置是否正确
---

用户执行了 `/note-check`。

1. 检查全局配置 `~/.config/note-distill/config.json` 是否存在：
   - 不存在 → 提示"全局配置文件未找到，请先执行 `/note-config` 初始化。"，结束。
   - 存在 → 继续。

2. 解析全局配置 JSON：
   - 解析失败 → 报错 `config.json 不是合法的 JSON 文件`，结束。
   - 解析成功 → 继续。

2.5 检查项目级配置 `./.note-distill.json`（若存在）：
   - 解析失败 → 报错 `.note-distill.json 不是合法的 JSON 文件`，结束。
   - 解析成功 → 与全局配置合并（项目覆盖全局，嵌套对象递归合并），继续用合并后的配置检查。

3. 根据合并后配置的 `adapter` 字段检查路径：
   - `local-markdown` → 检查 `output_dir`：为空则报"output_dir 未填写"；不为空则 `mkdir -p` 试建，失败则报"output_dir 不可写"
   - `obsidian` → 检查 `obsidian_vault_path`：为空则报"obsidian_vault_path 未填写"；不为空则检查目录是否存在
   - 其他值 → 报"不支持的 adapter: <值>"

4. 检查 topic 可用性（三级回退：项目 `.note-distill/topics/` > 用户 `~/.config/note-distill/topics/` > 出厂 `{SKILL_DIR}/topics/`）：
   - 用户级 `~/.config/note-distill/topics/` 为空 → 仅提示"用户目录下无自定义 topic，将使用出厂模板"，不算错误
   - 确认至少有一个可用 topic（含 `prompt.md` + `template.md`），无则报错

5. 检查 `candidate_selection`（缺失时从出厂配置继承，仅提示）：
   - `default_behavior` 若存在，必须是 `auto` / `pick` / `all`
   - `auto_pick_strategy` 若存在，必须是 `oldest` / `newest` / `priority`
   - `max_pick_options` 若存在，必须是正整数

6. 检查 `candidate_analyzer`（缺失时从出厂配置继承，仅提示）：
   - `enabled` 若存在，必须是布尔值（默认 `true`；设 `false` 关闭自动候选词提取）
   - `provider` 若存在，必须是 `auto` / `claude` / `codebuddy` / `heuristic` / `fake`
   - `model` 可为空；默认 `haiku`（语义名，经 CLI_MODEL_MAP 映射为各 provider 的实际 model ID）
   - `fallback` 若存在，必须是 `heuristic` / `none`

7. 权限检查：按 adapter 取目标根目录（`output_dir` 或 `obsidian_vault_path`），
   尝试 `mkdir -p <target_root>` 和 `Write` 一个测试文件：
   - 成功 → 立即删除测试文件，通过
   - 失败 → 提示用户将以下规则添加到 `.claude/settings.local.json`：
     ```
     "Bash(date *)",
     "Bash(mkdir *)",
     "Read(<target_root>/**)",
     "Write(<target_root>/**)"
     ```

8. 汇总报告：
   - 全部通过 → ✅ 配置正常（全局 + 项目级合并）。可以用 `/note` 或 `/note <topic>` 开始记笔记。
   - 有问题 → 逐项列出问题 + 修复建议
   - 若项目级配置存在 → 注明"已合并项目级配置 `./.note-distill.json`"
