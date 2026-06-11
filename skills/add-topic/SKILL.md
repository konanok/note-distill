---
name: add-topic
description: 创建/新增/自定义 note-distill topic。帮助用户设计笔记模板和写作规范，用于记录周报、复盘、事故报告、技术分享等自定义内容类型。触发词：新建topic、添加topic、自定义笔记类型、创建topic、add topic、create topic
argument-hint: [可选：topic 名称]
---

用户希望创建一个自定义 note-distill topic。

## 流程

### 1. 读取创建规范

Read `./references/topic-creation-guide.md`（相对于本 SKILL.md），严格遵守其中的硬约束。

### 2. 确认基本信息

若用户已说明用途（如"创建 topic 记录周报"），直接从中提取：
- `TOPIC_NAME`：英文/拼音短名（如 `weekly-report`）
- `TOPIC_DESC`：用途描述

若信息不足，用一句话提问补充（如"topic 叫什么名字？"），不要逐项追问。

### 3. 检查命名冲突

运行以下命令列出所有已注册 topic：

```bash
node --experimental-strip-types skills/note/scripts/topic-info.ts \
  --topics-dir ~/.config/note-distill/topics
```

再手动检查项目级 `./.note-distill/topics/` 和出厂 `skills/note/topics/` 下是否有同名目录。若 `TOPIC_NAME` 已被占用，告知用户并换名。同时检查用户起的 aliases 是否与任何已注册 topic 的 canonical name 或 alias 冲突。

### 4. 按规范生成文件

按 topic-creation-guide.md 的规范，直接生成 `prompt.md` 和 `template.md`：

1. 根据 `TOPIC_DESC` 推断合适的记录标准、边界排他、写作风格
2. 设计合理的 section 结构（至少 2 个必填 section）
3. 为每个 section 写 HTML 注释填充指引
4. 生成 scope（正向定义 + 排他声明，参考出厂 scope 写法）
5. 如不涉及 status 流转或 follow-up，不添加相关字段

**不要逐项向用户确认**——直接生成完整文件，让用户审阅。用户有意见再改。

### 5. 写入文件

默认放到用户级目录：

```bash
mkdir -p ~/.config/note-distill/topics/<TOPIC_NAME>/
```

依次 Write `prompt.md` 和 `template.md`。

文件已存在时告知用户并询问是否覆盖。

### 6. 校验

```bash
node --experimental-strip-types skills/note/scripts/topic-info.ts \
  --name <TOPIC_NAME> --topics-dir ~/.config/note-distill/topics
```

`found: false` → 检查 frontmatter 格式（最常见原因：aliases 用了多行、scope 换行），修正后重试。

### 7. 询问是否需要移到项目级

创建成功后，简要提示：`当前 topic 放在用户级目录（所有项目通用）。需要移到当前项目级吗？`

用户确认 → 将目录从 `~/.config/note-distill/topics/<name>/` 移到 `./.note-distill/topics/<name>/`。移动后重新运行步骤 6 的校验（将 `--topics-dir` 改为 `./.note-distill/topics`）。

### 8. 回报

告知：
- topic 已就位，可用 `/note <canonical_name>` 或 `/note <alias>`（如有）触发
- 放置位置（用户级/项目级）
