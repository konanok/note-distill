# Style: til（Today I Learned）

## 定位

面向**碎片化速记**。记录刚学到的一个小知识点，不求深度，只求不丢失。是知识体系的"种子"——以后可以升级为 technical 或 evergreen 笔记。

## 写作哲学

- **极简优先**：一个知识点，一次记录，不展开
- **硬上限 150 字**（不含代码块）：超出说明内容不适合 TIL，应改用 technical 风格
- 不需要原理，不需要备选方案，不需要验证证据
- 面向自己，口语化可以接受

## 对模板的覆盖规则

覆盖 `quick-template.md`：

```markdown
---
{frontmatter}
---

# TIL: {动词短语，描述学到什么}

{1 句话：在什么场景下会用到}

## 怎么做

{命令/代码/步骤。保持最简。}

## 值得深入？（可选，subagent 判断是否有价值才加）

- {为什么这个知识点值得扩充，或有哪些延伸方向}
- 相关：[[相关概念]]
```

- 去掉原 quick-template 的「备注」section
- 「场景」压缩为正文第一句，不单独成 section
- 「值得深入？」section：仅当 subagent 判断该知识点有明显延伸价值时添加，否则省略

## 标题规范

**强制格式**：`TIL: {动词短语}`

示例：
- `TIL: zsh 用 \`\`cd -\`\` 跳回上一个目录`
- `TIL: git stash 可以只暂存部分文件`
- `TIL: Python f-string 支持 = 号直接打印变量名`

## frontmatter

在 adapter 默认 frontmatter 基础上，强制添加：

```yaml
tags: [til, <domain-tag>]   # til 标签必须在第一位
status: seed                 # 标记为种子笔记，待后续深化
upgrade_to: <technical|evergreen|null>  # subagent 判断：该知识点更适合升级为哪种风格；无明显方向则填 null
```

## 文件存放

覆盖 adapter 的默认路径，存入 `{vault}/TIL/` 目录。

## wikilinks

不主动添加 wikilinks，保持轻量。仅在「值得深入？」section 中酌情添加 1-2 个。

## 适用模式

**仅适用于 quick 模式**。若用户指定 `--style til` 同时指定 `deep`，subagent 应忽略 deep，强制使用 quick。
