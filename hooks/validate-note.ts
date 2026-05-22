/**
 * validate-note.ts — 校验生成的笔记是否符合模板定义。
 *
 * 用法:
 *   node --experimental-strip-types hooks/validate-note.ts <note.md> \
 *     --template <template.md>
 *
 * 校验规则:
 *   1. Section 结构: 模板中的 ## 标题必须在笔记中存在且文本完全一致。
 *      标注"（可选）"的 section 不强制。
 *   2. Frontmatter: 模板 frontmatter 中的必填字段必须存在且非空。
 *      标记为 {{...}} 的字段如未替换则报错。
 *
 * 退出码: 0 = PASS, 1 = FAIL
 */

import * as fs from "node:fs";

// ---- types ----

interface ValidationError {
  level: "HARD" | "WARN";
  message: string;
}

// ---- helpers ----

function parseArgs(): { notePath: string; templatePath: string } {
  const args = process.argv.slice(2);
  let notePath = "";
  let templatePath = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--template" && i + 1 < args.length) {
      templatePath = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      notePath = args[i];
    }
  }

  if (!notePath || !templatePath) {
    console.error("用法: validate-note.ts <note.md> --template <template.md>");
    process.exit(2);
  }

  return { notePath, templatePath };
}

function extractFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

function extractSections(content: string): Set<string> {
  const sections = new Set<string>();
  const re = /^## (.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    sections.add(m[1].trim());
  }
  return sections;
}

function isOptional(sectionTitle: string): boolean {
  return /（可选）/.test(sectionTitle);
}

function countCharsWithoutCodeBlocks(content: string): number {
  // Remove code blocks and their content
  const withoutCode = content.replace(/```[\s\S]*?```/g, "");
  // Remove frontmatter
  const withoutFM = withoutCode.replace(/^---\n[\s\S]*?\n---/, "");
  return withoutFM.replace(/\s/g, "").length;
}

// ---- main validation ----

function validate(): void {
  const { notePath, templatePath } = parseArgs();

  if (!fs.existsSync(notePath)) {
    console.error(`笔记文件不存在: ${notePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(templatePath)) {
    console.error(`模板文件不存在: ${templatePath}`);
    process.exit(1);
  }

  const noteContent = fs.readFileSync(notePath, "utf-8");
  const templateContent = fs.readFileSync(templatePath, "utf-8");

  const errors: ValidationError[] = [];

  // 1. Section 结构校验
  const templateSections = extractSections(templateContent);
  const noteSections = extractSections(noteContent);

  for (const section of templateSections) {
    if (isOptional(section)) continue;
    if (!noteSections.has(section)) {
      errors.push({
        level: "HARD",
        message: `缺少 section: "## ${section}"`,
      });
    }
  }

  // 2. Frontmatter 校验
  const templateFM = extractFrontmatter(templateContent);
  const noteFM = extractFrontmatter(noteContent);

  if (!noteFM) {
    errors.push({ level: "HARD", message: "笔记缺少 frontmatter" });
  } else if (templateFM) {
    for (const key of Object.keys(templateFM)) {
      const templateVal = templateFM[key];
      const noteVal = noteFM[key];

      // 包含 {{...}} → 必填，未替换则报错
      if (/\{\{/.test(templateVal)) {
        if (!noteVal || noteVal.trim() === "") {
          errors.push({
            level: "HARD",
            message: `frontmatter 缺少字段: ${key}`,
          });
        } else if (/\{\{/.test(noteVal)) {
          errors.push({
            level: "HARD",
            message: `frontmatter 字段未替换: ${key} = "${noteVal}"`,
          });
        }
      }
    }
  }

  // 3. 模板变量残留检测（全文）
  const unresolved = noteContent.match(/\{\{[^}]+\}\}/g);
  if (unresolved) {
    for (const m of unresolved) {
      errors.push({
        level: "HARD",
        message: `未替换的模板变量: ${m}`,
      });
    }
  }

  // 4. 代码块 language 标注（软约束）
  const codeBlocks = noteContent.matchAll(/```(\S*)\n/g);
  for (const m of codeBlocks) {
    if (m[1] === "") {
      const lineNum = noteContent.substring(0, m.index!).split("\n").length;
      errors.push({
        level: "WARN",
        message: `代码块缺少 language 标注 (第 ${lineNum} 行)`,
      });
    }
  }

  // ---- output ----
  const hardErrors = errors.filter((e) => e.level === "HARD");
  const warnings = errors.filter((e) => e.level === "WARN");

  if (hardErrors.length > 0) {
    console.log(`FAIL (${hardErrors.length} hard errors):`);
    for (const e of hardErrors) {
      console.log(`  [HARD] ${e.message}`);
    }
    if (warnings.length > 0) {
      console.log(`WARN (${warnings.length} warnings):`);
      for (const e of warnings) {
        console.log(`  [WARN] ${e.message}`);
      }
    }
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`PASS (${warnings.length} warnings):`);
    for (const e of warnings) {
      console.log(`  [WARN] ${e.message}`);
    }
  } else {
    console.log("PASS: 所有校验通过");
  }

  process.exit(0);
}

validate();
