import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

// ---- path ----

export function expandHome(path: string): string {
  if (path === "~") return process.env.HOME || path;
  if (path.startsWith("~/"))
    return join(process.env.HOME || "~", path.slice(2));
  return path;
}

// ---- constants ----

export const PLATFORM_CLAUDE = "claude-code";
export const PLATFORM_CODEBUDDY = "codebuddy";

export const DATA_HOME = expandHome(
  process.env.NOTE_DISTILL_DATA_DIR || "~/.local/share/note-distill"
);

// ---- session paths ----

export function sessionPath(sessionId: string, filename: string): string {
  return join(DATA_HOME, "sessions", sessionId, filename);
}
export const CONFIG_PATH = expandHome(
  process.env.NOTE_DISTILL_CONFIG || "~/.config/note-distill/config.json"
);
export const PRIORITY_WEIGHTS: Record<string, number> = {
  bugfix: 100,
  decision: 90,
  architecture: 85,
  gotcha: 80,
  howto: 70,
  command: 60,
  research: 50,
};

export function utcNow(): string {
  return new Date().toISOString();
}

// ---- jsonl ----

export function loadJsonl(path: string): JsonObject[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function readFirstEvent(path: string): JsonObject | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf8");
    const firstLine = content.split("\n").find((line) => line.trim());
    return firstLine ? JSON.parse(firstLine) : null;
  } catch {
    return null;
  }
}

export function writeJsonl(path: string, records: JsonObject[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(
    tempPath,
    records.map((record) => JSON.stringify(record)).join("\n") +
      (records.length ? "\n" : ""),
    "utf8"
  );
  renameSync(tempPath, path);
}

// ---- config ----

function stripCommentKeys(obj: JsonObject): JsonObject {
  if (Array.isArray(obj))
    return obj.map(stripCommentKeys) as unknown as JsonObject;
  if (obj && typeof obj === "object") {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("_")) continue;
      out[k] = stripCommentKeys(v as JsonObject);
    }
    return out;
  }
  return obj;
}

const EXAMPLE_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "skills",
  "note",
  "config.example.json"
);

function loadGlobalConfig(): JsonObject {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return stripCommentKeys(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch {
    return {};
  }
}

function loadProjectConfig(): JsonObject {
  const projectPath = join(process.cwd(), ".note-distill.json");
  if (!existsSync(projectPath)) return {};
  try {
    return stripCommentKeys(JSON.parse(readFileSync(projectPath, "utf8")));
  } catch {
    return {};
  }
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const overrideVal = override[key];
    const baseVal = base[key];
    if (
      overrideVal &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal) &&
      baseVal &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal as JsonObject, overrideVal as JsonObject);
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

export function loadConfig(): JsonObject {
  let exampleConfig: JsonObject = {};
  try {
    exampleConfig = stripCommentKeys(
      JSON.parse(readFileSync(EXAMPLE_CONFIG_PATH, "utf8"))
    );
  } catch {}
  return stripCommentKeys(
    deepMerge(exampleConfig, deepMerge(loadGlobalConfig(), loadProjectConfig()))
  );
}

export function analyzerConfig(): JsonObject {
  const config = loadConfig();
  const analyzer =
    config.candidate_analyzer && typeof config.candidate_analyzer === "object"
      ? config.candidate_analyzer
      : {};
  return {
    enabled:
      process.env.NOTE_DISTILL_ANALYZER_ENABLED === "0" ||
      process.env.NOTE_DISTILL_ANALYZER_ENABLED === "false"
        ? false
        : analyzer.enabled != null
        ? String(analyzer.enabled) !== "false" &&
          String(analyzer.enabled) !== "0" &&
          String(analyzer.enabled) !== "null"
        : true,
    provider: analyzer.provider || process.env.NOTE_DISTILL_ANALYZER_PROVIDER,
    model: analyzer.model || process.env.NOTE_DISTILL_ANALYZER_MODEL || "haiku",
    fallback: analyzer.fallback || "heuristic",
  };
}

// ---- model ----

export function resolveModel(
  model: string,
  platform: string,
  config?: JsonObject
): string {
  if (platform === PLATFORM_CLAUDE) return model;
  const cfg = config || loadConfig();
  const modelMap =
    (cfg.model_map as Record<string, Record<string, string>>) || {};
  const platformMap = modelMap[platform];
  return platformMap?.[model] || model;
}

// ---- platform ----

export function detectPlatform(transcriptPath: string): string {
  if (!transcriptPath) return "unknown";
  if (transcriptPath.includes(".claude/")) return PLATFORM_CLAUDE;
  if (
    transcriptPath.includes("CodeBuddyExtension") ||
    transcriptPath.includes(".codebuddy/")
  )
    return PLATFORM_CODEBUDDY;
  return "unknown";
}

// ---- cli ----

export function parseOptions(
  args: string[],
  optionNames: string[]
): { positionals: string[]; options: Record<string, string> } {
  const options: Record<string, string> = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (!optionNames.includes(name))
        throw new Error(`unknown option --${name}`);
      const value = args[index + 1];
      if (value === undefined) throw new Error(`missing value for --${name}`);
      options[name] = value;
      index += 1;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, options };
}

// ---- events ----

export function payload(event: JsonObject): JsonObject {
  return event.payload && typeof event.payload === "object"
    ? event.payload
    : {};
}

export function promptFor(event: JsonObject): string {
  return String(payload(event).prompt || event.prompt || "");
}

export function assistantFor(event: JsonObject): string {
  return String(payload(event).last_assistant_message || "");
}

export function isNotePrompt(event: JsonObject): boolean {
  return (
    event.event === "UserPromptSubmit" &&
    promptFor(event).trimStart().startsWith("/note")
  );
}

export function currentNoteWindow(
  events: JsonObject[]
): [number | null, number | null] {
  const noteIndices = events
    .map((event, index) => (isNotePrompt(event) ? index : -1))
    .filter((index) => index !== -1);
  if (!noteIndices.length) return [null, null];
  const currentIndex = noteIndices[noteIndices.length - 1];
  const previousIndex =
    noteIndices.length > 1 ? noteIndices[noteIndices.length - 2] : null;
  return [previousIndex, currentIndex];
}

export function detectCoverage(
  events: JsonObject[]
): "empty" | "partial" | "full" {
  if (!events.length) return "empty";
  const firstUserPrompt = events.find(
    (event) => event.event === "UserPromptSubmit"
  );
  if (!firstUserPrompt) return "empty";
  return promptFor(firstUserPrompt).trimStart().startsWith("/note")
    ? "partial"
    : "full";
}

export function extractWindow(events: JsonObject[]): JsonObject {
  const coverage = detectCoverage(events);
  const [previousIndex, currentIndex] = currentNoteWindow(events);
  if (currentIndex === null) {
    return {
      coverage,
      previous_note: null,
      current_note: null,
      window_start: 0,
      window_end: events.length,
      events,
    };
  }
  const windowStart = previousIndex === null ? 0 : previousIndex + 1;
  return {
    coverage,
    previous_note:
      previousIndex === null
        ? null
        : { index: previousIndex, prompt: promptFor(events[previousIndex]) },
    current_note: {
      index: currentIndex,
      prompt: promptFor(events[currentIndex]),
    },
    window_start: windowStart,
    window_end: currentIndex,
    events: events.slice(windowStart, currentIndex),
  };
}
