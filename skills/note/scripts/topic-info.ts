#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUILTIN_TOPICS_DIR = join(SCRIPT_DIR, "..", "topics");

interface FrontmatterData {
  aliases: string[];
  scope: string;
}

interface TopicMeta {
  canonical: string;
  aliases: string[];
  scope: string;
  prompt_path: string;
  template_path: string | null;
}

function expandHome(path: string): string {
  if (path === "~") return process.env.HOME || path;
  if (path.startsWith("~/"))
    return join(process.env.HOME || "~", path.slice(2));
  return path;
}

function parseFrontmatter(content: string): FrontmatterData | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const body = match[1];

  // aliases: [a, b, c] or aliases: [] or absent
  // Only supports inline array format (design constraint: no YAML multiline lists)
  const aliasesMatch = body.match(/^aliases:\s*\[(.*)\]$/m);
  const aliases = aliasesMatch
    ? aliasesMatch[1]
        .split(",")
        .map((s: string) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
    : [];

  // scope: single line only (design constraint: no multiline scope)
  const scopeMatch = body.match(/^scope:\s*(.+)$/m);
  const scope = scopeMatch ? scopeMatch[1].trim() : "";

  return aliases.length || scope ? { aliases, scope } : null;
}

function scanTopics(topicsDirs: string[]): TopicMeta[] {
  const seen = new Map<string, TopicMeta>();

  for (const dir of topicsDirs) {
    const expandedDir = expandHome(dir);
    if (!existsSync(expandedDir)) continue;
    for (const entry of readdirSync(expandedDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue; // higher-priority dir already registered
      const promptPath = join(expandedDir, entry.name, "prompt.md");
      const templatePath = join(expandedDir, entry.name, "template.md");
      if (!existsSync(promptPath)) continue;
      const content = readFileSync(promptPath, "utf8");
      const fm = parseFrontmatter(content);
      seen.set(entry.name, {
        canonical: entry.name,
        aliases: fm?.aliases || [],
        scope: fm?.scope || "",
        prompt_path: resolve(promptPath),
        template_path: existsSync(templatePath) ? resolve(templatePath) : null,
      });
    }
  }

  return [...seen.values()].sort((a, b) => a.canonical.localeCompare(b.canonical));
}

function parseOptions(
  args: string[],
  optionNames: string[]
): { positionals: string[]; options: Record<string, string>; error?: boolean } {
  const options: Record<string, string> = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (!optionNames.includes(name)) {
        process.stderr.write(`error: unknown option --${name}\n`);
        return { positionals, options: {}, error: true };
      }
      const value = args[index + 1];
      if (value === undefined) {
        process.stderr.write(`error: missing value for --${name}\n`);
        return { positionals, options: {}, error: true };
      }
      options[name] = value;
      index += 1;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, options };
}

const HELP = `usage: topic-info.ts [--name <name>] [--topics-dir <path>]

Options:
  --name <name>       Look up a topic by canonical name or alias
  --topics-dir <path> Additional user topics directory
  --help, -h          Show this help message
`;

function commandTopicInfo(args: string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const parsed = parseOptions(args, ["name", "topics-dir"]);
  if (parsed.error) {
    process.stderr.write("usage: topic-info.ts [--name <name>] [--topics-dir <path>]\n");
    return 2;
  }
  const searchDirs = [
    join(process.cwd(), ".note-distill", "topics"),
    parsed.options["topics-dir"] || "",
    BUILTIN_TOPICS_DIR,
  ].filter(Boolean);

  const topics = scanTopics(searchDirs);

  if (parsed.options.name) {
    const query = parsed.options.name;
    // Direct name match first
    let found = topics.find((t) => t.canonical === query);
    // Then alias match
    if (!found) found = topics.find((t) => t.aliases.includes(query));

    if (found) {
      process.stdout.write(
        JSON.stringify({ query, found: true, ...found }, null, 2) + "\n"
      );
    } else {
      process.stdout.write(
        JSON.stringify({ query, found: false }, null, 2) + "\n"
      );
    }
  } else {
    process.stdout.write(JSON.stringify({ topics }, null, 2) + "\n");
  }
  return 0;
}

// Main
process.exitCode = commandTopicInfo(process.argv.slice(2));
