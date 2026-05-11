# Quick 模式笔记模板

## 目标

短、准、可直接抄走用。**50-300 字**，配一两个代码块。不做扩展原理、不做备选方案对比。

## 结构

```markdown
---
{frontmatter}
---

# {标题：一句话概括要解决什么 / 要达成什么}

## 场景
{一两句话描述：什么情况下用这条笔记。}

## 方案
{命令/代码/步骤。如果是命令，用 bash 代码块；如果是配置，用对应语言代码块。}

## 备注（可选）
- {踩过的坑}
- {注意事项}
```

## 风格要求

- 标题用动词开头，描述"做什么"（例：`压缩最近 N 次 git commit`、`zsh 快速跳转到上次目录`）。
- "场景"部分回答"什么时候我需要这条笔记"，不要写"今天我遇到了..."这种时序化叙述。
- 代码块必须可复制直接执行。参数用 `<placeholder>` 占位。
- 如果验证过，在代码块下加一行 `<!-- verified: YYYY-MM-DD -->`。

## 例子

~~~markdown
---
tags: [auto-note, git]
source: note-distill
mode: quick
created: 2026-05-09
verified: 2026-05-09
---

# 压缩最近 N 次 git commit 为一个

## 场景
本地开发多次小 commit，push 前想合并成一个干净的 commit。

## 方案
```bash
git rebase -i HEAD~<N>
# 把除第一行外的 pick 改成 squash（或 s），保存退出。
# 再编辑合并后的 commit message，保存退出。
```
<!-- verified: 2026-05-09 on git 2.45 -->

## 备注
- 已 push 到远端的 commit 不要 squash，会破坏协作历史。
- 如果只想改 commit message 不合并，用 `reword` 代替 `squash`。
~~~
