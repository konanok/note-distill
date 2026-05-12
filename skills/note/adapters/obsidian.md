# Obsidian Adapter

写入 Obsidian vault，支持 `[[wikilinks]]` 和 YAML frontmatter。

本 adapter 采用**两级降级链**，按可用性自动选择写入路径：

| 优先级 | 路径 | 触发条件 | 主要好处 |
|---|---|---|---|
| 1 | `Skill("obsidian")` | 能成功加载 obsidian skill，且 skill 指导的写入方式不依赖 GUI | 复用当前环境中最合适的 Obsidian 自动化能力；adapter 不绑定具体 CLI |
| 2 | `Bash mkdir -p` + `Write` | skill 不可用，或 skill 指导的路径需要 GUI / 不适合 headless | 零依赖兜底，server/CI 可用 |

## 关键约束：必须 headless-safe

note-distill 的 `/note` 是后台 fork subagent 任务，必须能在 server / SSH / CI / container 等无 GUI 环境中运行。

因此无论 obsidian skill 内部使用什么工具，都必须满足：

- 不依赖 GUI
- 不弹出 Obsidian app
- 不要求 Obsidian app 正在运行
- 能在纯文件系统 / 命令行环境中完成写入

官方 `obsidian` CLI 依赖 Obsidian app 运行，若 app 未运行会尝试启动 Obsidian，因此**不能作为本 adapter 的默认直接依赖**。如果某个 obsidian skill 的指导路径依赖官方 CLI 或其他 GUI 能力，必须降级到 Write。

## 配置读取

从 `~/.config/note-distill/config.json` 读以下字段：

- `obsidian_vault_path`：vault 的绝对路径（必填；始终作为目标 vault 根目录）
- `subfolder_by_mode.quick` / `subfolder_by_mode.deep`：按模式分子目录（默认 `quick` / `deep`）
- `templates_dir`：用户自定义模板目录（默认 `~/.config/note-distill/templates/`）。可省略。

## 模板解析

和 local-markdown adapter 共用同一套模板系统。详见 `local-markdown.md` 的"模板解析"章节。渲染后得到**完整笔记内容字符串**（含 frontmatter + 正文），供后续写入步骤使用。

## 工具探测与降级

子 agent 在真正写入前必须按序探测：

```
PATH_MODE = "write"  # 默认兜底
try Skill("obsidian"):
    if skill 指导的写入方式满足 headless-safe + exact-target 约束:
        PATH_MODE = "skill"
except:
    PATH_MODE = "write"
```

探测失败不要告警用户——用户看到的始终是"笔记写成功"。仅在 Write 兜底也失败时才通过 `SendMessage` 报错。

## 文件落点（两路共享）

```
<vault_root>/<OUTPUT_SUBDIR>/{{date}}-{{slug}}.md
```

- `OUTPUT_SUBDIR` 已由主 agent 解析（考虑风格覆盖），直接使用
- `<vault_root>` 始终来自 config 的 `obsidian_vault_path`
- Obsidian skill 不得改写目标 vault；若 skill 只能写入其自行解析的默认/当前 vault，且无法确认该 vault 等于 `obsidian_vault_path`，必须降级到 Write

例：`<vault>/TIL/2026-05-11-git-squash-commits.md`

## 文件名规则（两路共享）

`{{date}}-{{slug}}.md`：

- `date`：`YYYY-MM-DD`，由 `date +%Y-%m-%d` 获取
- `slug`：从笔记标题生成，英文、小写、连字符分隔、最多 50 字符

## 冲突处理（两路共享）

无论 skill 内部使用什么工具，文件冲突语义都由 note-distill adapter 统一控制：

```
stem = "<vault>/<OUTPUT_SUBDIR>/<date>-<slug>"
target = "${stem}.md"
n = 2
while [ -f "$target" ]; do
    # Read target 与新渲染内容比较
    if 内容等价: 跳过本次写入, return target   # 幂等
    target = "${stem}-${n}.md"
    n=$((n+1))
done
# 继续写入 target
```

## 写入步骤（按路径分流）

### 路径 1：Obsidian skill 优先

1. 调用 `Skill("obsidian")` 加载当前环境中的 Obsidian 自动化指导
2. 仅当 skill 提供的方法同时满足以下条件时，才使用 skill 路径：
   - 直接把完整 Markdown 内容写入 adapter 已计算好的 exact target path
   - 不自行决定文件名、目录或冲突策略
   - 不使用 URI handler、`--open`、app launch/open 行为或 GUI 自动化
   - 不要求 Obsidian app 已安装或正在运行
   - 写入后能回到本 adapter 的 Read 验证与 SendMessage 绝对路径回报流程
3. 若 skill 建议使用需要 GUI 的工具（例如官方 `obsidian` CLI 会启动/控制 Obsidian app），或无法确认写入目标等于 adapter 已计算的 target，立即放弃 skill 路径，改用 Write 兜底
4. 若 skill 指导里出现与本 adapter 冲突的规则（例如建议改文件名风格），**以本 adapter 为准**——skill 是通用指导，本 adapter 是 note-distill 专属约束

> 当前常见的 `obsidian` skill 使用第三方 `obsidian-cli` / NotesMD CLI 路线；这些命令名仅用于说明 skill 的内部实现历史。adapter/subagent 不得直接探测、调用或依赖这些命令；即使 skill 文档提到它们，也只有明确满足 headless-safe 和 exact-target 写入条件时才能使用。

### 路径 2：Write 兜底

```bash
mkdir -p "<vault>/<OUTPUT_SUBDIR>"
```
然后 `Write` 工具写入 `<vault>/<OUTPUT_SUBDIR>/<filename>.md`，`content` 为渲染后完整字符串。

## Wikilinks 处理（两路共享）

在 deep 模式笔记中主动添加 `[[概念名]]`：

- 识别标准术语（如 `[[NUMA]]`、`[[git rebase]]`）
- 每篇 3-8 个为宜
- 不确定 vault 里是否已有也可写，Obsidian 自动处理

## 写入后的确认（两路共享）

1. 用 Read 工具回读文件前 20 行，确认 frontmatter 正确
2. 确认文件大小 > 200 字节
3. 通过 `SendMessage（recipient="main"）` 回报**绝对路径**（skill 路径若不输出绝对路径，需自己拼）

## 跨平台路径注意

- macOS 上 vault 可能在 `~/Documents/Obsidian/...` 或 iCloud 路径
- 路径含空格时 Bash 命令加引号；Write 工具无需特殊处理
- skill 若使用相对 vault 路径，最终回报仍必须转换为绝对路径
