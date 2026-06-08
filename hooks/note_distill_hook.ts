#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const DATA_HOME = expandHome(
  process.env.NOTE_DISTILL_DATA_DIR || "~/.local/share/note-distill"
);
const CONFIG_PATH = expandHome(
  process.env.NOTE_DISTILL_CONFIG || "~/.config/note-distill/config.json"
);
const LOCK_TIMEOUT_MS =
  Number(process.env.NOTE_DISTILL_ANALYZER_LOCK_TIMEOUT_MS) || 60_000;
const SECRET_PATTERNS: RegExp[] = [
  /(password|passwd|pwd|token|api[_-]?key|secret[_-]?key|secret)\s*[:=]\s*\S+/gi,
  /\bbearer\s+\S+/gi,
];
const KEYWORDS: Record<string, string> = {
  方案: "decision",
  设计: "architecture",
  架构: "architecture",
  问题: "gotcha",
  修复: "bugfix",
  命令: "command",
  配置: "howto",
};
const PRIORITY_WEIGHTS: Record<string, number> = {
  bugfix: 100,
  decision: 90,
  architecture: 85,
  gotcha: 80,
  howto: 70,
  command: 60,
  research: 50,
};

type JsonObject = Record<string, any>;

function expandHome(path: string): string {
  if (path === "~") return process.env.HOME || path;
  if (path.startsWith("~/"))
    return join(process.env.HOME || "~", path.slice(2));
  return path;
}

function utcNow(): string {
  return new Date().toISOString();
}

function readStdin(): Promise<string> {
  return new Promise((resolveRead, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolveRead(data));
    process.stdin.on("error", reject);
  });
}

function loadGlobalConfig(): JsonObject {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function loadProjectConfig(): JsonObject {
  const projectPath = join(process.cwd(), ".note-distill.json");
  if (!existsSync(projectPath)) return {};
  try {
    return JSON.parse(readFileSync(projectPath, "utf8"));
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

function loadConfig(): JsonObject {
  return deepMerge(loadGlobalConfig(), loadProjectConfig());
}

function analyzerConfig(): JsonObject {
  const config = loadConfig();
  const analyzer =
    config.candidate_analyzer && typeof config.candidate_analyzer === "object"
      ? config.candidate_analyzer
      : {};
  return {
    provider:
      analyzer.provider ||
      process.env.NOTE_DISTILL_ANALYZER_PROVIDER ||
      "claude",
    model:
      analyzer.model ||
      process.env.NOTE_DISTILL_ANALYZER_MODEL ||
      "claude-haiku-4-5-20251001",
    fallback: analyzer.fallback || "heuristic",
  };
}

function loadJsonl(path: string): JsonObject[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function readFirstEvent(path: string): JsonObject | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf8");
    const firstLine = content.split("\n").find((line) => line.trim());
    return firstLine ? JSON.parse(firstLine) : null;
  } catch {
    return null;
  }
}

function detectPlatform(transcriptPath: string): string {
  if (!transcriptPath) return "unknown";
  if (transcriptPath.includes(".claude/")) return "claude-code";
  if (
    transcriptPath.includes("CodeBuddyExtension") ||
    transcriptPath.includes(".codebuddy/")
  )
    return "codebuddy";
  return "unknown";
}

function writeJsonl(path: string, records: JsonObject[]): void {
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

function appendJsonl(path: string, record: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

function safeSessionId(sessionId: unknown): string {
  const value = String(sessionId ?? "unknown");
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";
}

function redact(value: unknown): string {
  let redacted = String(value || "");
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      const key = match.match(
        /^(\s*)(password|passwd|pwd|token|api[_-]?key|secret[_-]?key|secret)/i
      );
      if (key) return `${key[1]}${key[2]}=[REDACTED]`;
      return "Bearer [REDACTED]";
    });
  }
  return redacted;
}

function hookPayload(event: JsonObject): JsonObject {
  if (event.hook_event_name === "UserPromptSubmit")
    return { prompt: redact(event.prompt || "") };
  if (event.hook_event_name === "Stop")
    return {
      last_assistant_message: redact(event.last_assistant_message || ""),
    };
  return {};
}

function eventRecord(event: JsonObject): JsonObject {
  const sessionId = safeSessionId(event.session_id);
  return {
    schema: SCHEMA_VERSION,
    event: event.hook_event_name || "unknown",
    session_id: sessionId,
    timestamp: utcNow(),
    cwd: event.cwd || "",
    transcript_path: event.transcript_path || "",
    payload: hookPayload(event),
  };
}

function sessionEventsPath(sessionId: string): string {
  return join(DATA_HOME, "sessions", safeSessionId(sessionId), "events.jsonl");
}

function logError(message: string): void {
  appendJsonl(join(DATA_HOME, "logs", "session-collector-error.log"), {
    timestamp: utcNow(),
    message,
  });
}

function maybeStartAnalyzer(record: JsonObject, eventsPath: string): void {
  if (record.event !== "Stop") return;
  const outputPath = join(dirname(eventsPath), "note_candidates.jsonl");
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      scriptPath,
      "analyze",
      eventsPath,
      "--output",
      outputPath,
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  child.on("error", (err) => {
    logError(`analyzer spawn failed: ${err.message}`);
  });
  child.unref();
}

async function commandCollect(): Promise<number> {
  try {
    const raw = await readStdin();
    const event = raw.trim() ? JSON.parse(raw) : {};
    const record = eventRecord(event);
    const eventsPath = sessionEventsPath(record.session_id);
    appendJsonl(eventsPath, record);
    maybeStartAnalyzer(record, eventsPath);
  } catch (error) {
    try {
      logError(`${(error as Error).name}: ${(error as Error).message}`);
    } catch {}
  }
  process.stdout.write(
    JSON.stringify({ continue: true, suppressOutput: true }) + "\n"
  );
  return 0;
}

function payload(event: JsonObject): JsonObject {
  return event.payload && typeof event.payload === "object"
    ? event.payload
    : {};
}

function promptFor(event: JsonObject): string {
  return String(payload(event).prompt || event.prompt || "");
}

function assistantFor(event: JsonObject): string {
  return String(payload(event).last_assistant_message || "");
}

function isNotePrompt(event: JsonObject): boolean {
  return (
    event.event === "UserPromptSubmit" &&
    promptFor(event).trimStart().startsWith("/note")
  );
}

function currentNoteWindow(
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

/**
 * Determine how well the hook log covers the main session.
 *
 * - `empty`   : no events at all → hook completely unavailable.
 * - `partial` : the first UserPromptSubmit in the log already starts with `/note`,
 *               meaning the hook only started recording at (or after) the user's
 *               `/note` invocation. Anything that happened earlier in the session
 *               was NOT captured, so candidates and the event window built from
 *               this log are not trustworthy as the sole source of material.
 * - `full`    : there is at least one non-`/note` UserPromptSubmit before any
 *               `/note` invocation, so the hook has recorded actual discussion
 *               history. Candidates / window may still be small, but they are
 *               trustworthy within their range.
 *
 * Note: this is a heuristic — it cannot tell whether the conversation existed
 * BEFORE the very first UserPromptSubmit in the log. We treat that boundary as
 * the hook's earliest knowable point and accept that limitation.
 */
function detectCoverage(events: JsonObject[]): "empty" | "partial" | "full" {
  if (!events.length) return "empty";
  const firstUserPrompt = events.find(
    (event) => event.event === "UserPromptSubmit"
  );
  if (!firstUserPrompt) return "empty";
  return promptFor(firstUserPrompt).trimStart().startsWith("/note")
    ? "partial"
    : "full";
}

function extractWindow(events: JsonObject[]): JsonObject {
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

function commandWindow(args: string[]): number {
  const eventsPath = args[0];
  if (!eventsPath) return usage("window <events.jsonl>");
  process.stdout.write(
    JSON.stringify(extractWindow(loadJsonl(resolve(eventsPath))), null, 2) +
      "\n"
  );
  return 0;
}

function candidateType(text: string): string | null {
  for (const [keyword, kind] of Object.entries(KEYWORDS)) {
    if (text.includes(keyword)) return kind;
  }
  return null;
}

function shortTitle(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact ? compact.slice(0, 60) : "Untitled note candidate";
}

function candidateId(sessionId: string, prompt: string, index: number): string {
  const digest = createHash("sha1")
    .update(`${sessionId}\0${index}\0${prompt}`)
    .digest("hex")
    .slice(0, 12);
  return `cand-${digest}`;
}

function buildHeuristicCandidates(
  events: JsonObject[],
  eventsPath?: string
): JsonObject[] {
  const candidates: JsonObject[] = [];
  events.forEach((event, index) => {
    if (event.event !== "UserPromptSubmit") return;
    const prompt = promptFor(event);
    if (prompt.trimStart().startsWith("/note")) return;
    const kind = candidateType(prompt);
    if (!kind) return;
    const followingStopIndex = events.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        candidate.event === "Stop" &&
        assistantFor(candidate)
    );
    const followingStop =
      followingStopIndex >= 0 ? events[followingStopIndex] : null;
    const answer = followingStop ? assistantFor(followingStop) : "";
    const sessionId = String(
      event.session_id || followingStop?.session_id || "unknown"
    );
    const evidence = answer ? [prompt, answer] : [prompt];
    const sourceRefs = eventsPath
      ? [
          {
            kind: "event_range",
            path: eventsPath,
            start_index: index,
            end_index: followingStopIndex >= 0 ? followingStopIndex : index,
            transcript_path:
              event.transcript_path || followingStop?.transcript_path || "",
          },
        ]
      : [];
    candidates.push({
      schema: SCHEMA_VERSION,
      candidate_id: candidateId(sessionId, prompt, index),
      session_id: sessionId,
      created_at: utcNow(),
      range: {
        prompt_event_index: index,
        stop_event_index: followingStopIndex >= 0 ? followingStopIndex : null,
      },
      type: kind,
      title: shortTitle(prompt),
      summary: answer || prompt,
      evidence,
      source_refs: sourceRefs,
      status: "pending",
    });
  });
  return candidates;
}

function buildFakeCandidates(
  events: JsonObject[],
  eventsPath?: string
): JsonObject[] {
  const userIndex = events.findIndex(
    (event) =>
      event.event === "UserPromptSubmit" &&
      !promptFor(event).trimStart().startsWith("/note")
  );
  if (userIndex < 0) return [];
  const stopIndex = events.findIndex(
    (event, index) => index > userIndex && event.event === "Stop"
  );
  const prompt = promptFor(events[userIndex]);
  const answer = stopIndex >= 0 ? assistantFor(events[stopIndex]) : "";
  return [
    {
      schema: SCHEMA_VERSION,
      candidate_id: candidateId(
        String(events[userIndex].session_id || "fake"),
        prompt,
        userIndex
      ),
      session_id: String(events[userIndex].session_id || "fake"),
      created_at: utcNow(),
      range: {
        prompt_event_index: userIndex,
        stop_event_index: stopIndex >= 0 ? stopIndex : null,
      },
      type: "decision",
      title: shortTitle(prompt),
      summary: answer || prompt,
      claim: answer || prompt,
      why: "fake analyzer provider selected this as a recordable candidate",
      confidence: "medium",
      evidence: answer ? [prompt, answer] : [prompt],
      source_refs: eventsPath
        ? [
            {
              kind: "event_range",
              path: eventsPath,
              start_index: userIndex,
              end_index: stopIndex >= 0 ? stopIndex : userIndex,
              transcript_path: events[userIndex].transcript_path || "",
            },
          ]
        : [],
      status: "pending",
      analyzer: { provider: "fake", model: "fake" },
    },
  ];
}

function buildAnalyzerPrompt(events: JsonObject[]): string {
  return [
    "You are note-distill candidate analyzer.",
    'Return ONLY JSON: {"candidates":[{"type":"decision|bugfix|howto|gotcha|architecture|command|research","title":"...","summary":"...","claim":"...","why":"...","confidence":"high|medium|low","event_range":{"start_index":0,"end_index":1}}]}',
    "Record only reusable technical knowledge, decisions, bugfixes, howtos, gotchas, or architecture trade-offs.",
    JSON.stringify(events),
  ].join("\n\n");
}

function normalizeModelCandidates(
  rawCandidates: JsonObject[],
  events: JsonObject[],
  eventsPath?: string,
  provider = "model",
  model = ""
): JsonObject[] {
  return rawCandidates.map((candidate, index) => {
    const range =
      candidate.event_range && typeof candidate.event_range === "object"
        ? candidate.event_range
        : {};
    const startIndex = Number.isInteger(range.start_index)
      ? range.start_index
      : 0;
    const endIndex = Number.isInteger(range.end_index)
      ? range.end_index
      : startIndex;
    const sourceEvent = events[startIndex] || {};
    const stopEvent = events[endIndex] || sourceEvent;
    const title = String(
      candidate.title || candidate.claim || "Untitled note candidate"
    );
    return {
      schema: SCHEMA_VERSION,
      candidate_id: candidateId(
        String(sourceEvent.session_id || stopEvent.session_id || provider),
        title,
        index
      ),
      session_id: String(
        sourceEvent.session_id || stopEvent.session_id || "unknown"
      ),
      created_at: utcNow(),
      range: { prompt_event_index: startIndex, stop_event_index: endIndex },
      type: String(candidate.type || "decision"),
      title: shortTitle(title),
      summary: String(candidate.summary || candidate.claim || title),
      claim: String(candidate.claim || candidate.summary || title),
      why: String(
        candidate.why ||
          "model analyzer selected this as reusable technical knowledge"
      ),
      confidence: String(candidate.confidence || "medium"),
      evidence: [String(candidate.summary || candidate.claim || title)],
      source_refs: eventsPath
        ? [
            {
              kind: "event_range",
              path: eventsPath,
              start_index: startIndex,
              end_index: endIndex,
              transcript_path:
                sourceEvent.transcript_path || stopEvent.transcript_path || "",
            },
          ]
        : [],
      status: "pending",
      analyzer: { provider, model },
    };
  });
}

function parseModelCandidates(
  stdout: string,
  events: JsonObject[],
  eventsPath?: string,
  provider = "model",
  model = ""
): JsonObject[] {
  const parsed = JSON.parse(stdout);
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  return normalizeModelCandidates(
    candidates,
    events,
    eventsPath,
    provider,
    model
  );
}

function findClaudeExecutable(): string | null {
  const configured = process.env.CLAUDE_CODE_PATH;
  if (configured && existsSync(configured)) return configured;
  const pathDirs = (process.env.PATH || "").split(":");
  for (const dir of pathDirs) {
    const candidate = join(dir, "claude");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function buildClaudeCandidates(
  events: JsonObject[],
  eventsPath: string | undefined,
  config: JsonObject
): JsonObject[] {
  const claude = findClaudeExecutable();
  if (!claude) {
    return config.fallback === "heuristic"
      ? buildHeuristicCandidates(events, eventsPath).map((candidate) => ({
          ...candidate,
          analyzer: {
            provider: "heuristic",
            fallback_from: "claude",
            reason: "claude_not_found",
          },
        }))
      : [];
  }
  const args = ["--print"];
  if (config.model) args.push("--model", String(config.model));
  const result = spawnSync(claude, args, {
    input: buildAnalyzerPrompt(events),
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status === 0) {
    try {
      return parseModelCandidates(
        result.stdout,
        events,
        eventsPath,
        "claude",
        String(config.model || "")
      );
    } catch {
      // fall through to fallback
    }
  }
  return config.fallback === "heuristic"
    ? buildHeuristicCandidates(events, eventsPath).map((candidate) => ({
        ...candidate,
        analyzer: {
          provider: "heuristic",
          fallback_from: "claude",
          reason: "claude_failed",
        },
      }))
    : [];
}

function buildModelCandidates(
  events: JsonObject[],
  eventsPath: string | undefined,
  config: JsonObject
): JsonObject[] {
  if (config.provider === "fake")
    return buildFakeCandidates(events, eventsPath);
  if (config.provider === "claude")
    return buildClaudeCandidates(events, eventsPath, config);
  return buildHeuristicCandidates(events, eventsPath).map((candidate) => ({
    ...candidate,
    analyzer: { provider: "heuristic" },
  }));
}

function commandAnalyze(args: string[]): number {
  const parsed = parseOptions(args, ["output"]);
  const eventsPath = parsed.positionals[0];
  if (!eventsPath) return usage("analyze <events.jsonl> [--output <path>]");
  const outputPath =
    parsed.options.output ||
    join(dirname(resolve(eventsPath)), "note_candidates.jsonl");
  const resolvedEventsPath = resolve(eventsPath);
  const resolvedOutput = resolve(outputPath);
  const lockPath = `${resolvedOutput}.lock`;
  // Prevent concurrent analyzer runs on the same output file.
  // The Stop hook triggers an async analyze on every Stop event;
  // two rapid Stops could otherwise race on the same candidates file.
  // Use openSync with 'wx' (exclusive write) for atomic lock acquisition.
  let lockHandle: number | undefined;
  try {
    lockHandle = openSync(lockPath, "wx");
    writeFileSync(lockPath, String(Date.now()), "utf8");
    closeSync(lockHandle);
  } catch {
    // Lock exists — check if it's stale.
    let lockTimestamp = 0;
    try {
      const content = readFileSync(lockPath, "utf8").trim();
      if (content) lockTimestamp = Number(content);
    } catch {}
    if (lockTimestamp && Date.now() - lockTimestamp < LOCK_TIMEOUT_MS) {
      process.stdout.write(
        JSON.stringify({
          candidates: 0,
          output: outputPath,
          skipped: "locked",
        }) + "\n"
      );
      return 0;
    }
    // Stale lock — break it and retry.
    try {
      unlinkSync(lockPath);
    } catch {}
    try {
      lockHandle = openSync(lockPath, "wx");
      writeFileSync(lockPath, String(Date.now()), "utf8");
      closeSync(lockHandle);
    } catch {
      process.stdout.write(
        JSON.stringify({
          candidates: 0,
          output: outputPath,
          skipped: "locked",
        }) + "\n"
      );
      return 0;
    }
  }
  try {
    const candidates = buildModelCandidates(
      loadJsonl(resolvedEventsPath),
      resolvedEventsPath,
      analyzerConfig()
    );
    if (existsSync(resolvedOutput)) {
      const existingById = new Map(
        loadJsonl(resolvedOutput).map((c) => [String(c.candidate_id), c])
      );
      const newIds = new Set(candidates.map((c) => String(c.candidate_id)));
      for (const c of candidates) {
        const existing = existingById.get(String(c.candidate_id));
        if (
          existing &&
          (existing.status === "consumed" || existing.status === "dismissed")
        ) {
          c.status = existing.status;
          if (existing.consumed_at) c.consumed_at = existing.consumed_at;
          if (existing.note_path) c.note_path = existing.note_path;
        }
      }
      // Preserve pending candidates from the existing file that were not regenerated.
      // This handles non-deterministic analyzers (e.g. Claude) that may produce
      // different candidate sets on re-analysis of the same append-only events file.
      for (const existing of loadJsonl(resolvedOutput)) {
        if (
          !newIds.has(String(existing.candidate_id)) &&
          existing.status === "pending"
        ) {
          candidates.push(existing);
        }
      }
    }
    writeJsonl(resolvedOutput, candidates);
    process.stdout.write(
      JSON.stringify({ candidates: candidates.length, output: outputPath }) +
        "\n"
    );
    return 0;
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}

function candidatePromptIndex(candidate: JsonObject): number | null {
  const value = candidate.range?.prompt_event_index;
  return Number.isInteger(value) ? value : null;
}

function inWindow(
  candidate: JsonObject,
  previousNote: number | null,
  currentNote: number | null
): boolean {
  if (currentNote === null) return true;
  const promptIndex = candidatePromptIndex(candidate);
  if (promptIndex === null) return false;
  return (
    (previousNote === null || promptIndex > previousNote) &&
    promptIndex < currentNote
  );
}

function searchableText(candidate: JsonObject): string {
  const parts = [
    candidate.title || "",
    candidate.summary || "",
    candidate.type || "",
  ];
  if (Array.isArray(candidate.evidence))
    parts.push(...candidate.evidence.map(String));
  return parts.join("\n").toLowerCase();
}

function topicMatches(candidate: JsonObject, topic?: string): boolean {
  if (!topic) return true;
  const normalized = topic.toLowerCase().trim().replace(/\s+/g, " ");
  if (!normalized) return true;
  const text = searchableText(candidate);
  const terms = normalized.split(" ");
  if (terms.length === 1) return text.includes(normalized);
  return terms.every((term) => text.includes(term));
}

function pendingCandidates(
  candidates: JsonObject[],
  previousNote: number | null,
  currentNote: number | null,
  topic?: string
): JsonObject[] {
  return candidates.filter(
    (candidate) =>
      candidate.status !== "consumed" &&
      candidate.status !== "dismissed" &&
      inWindow(candidate, previousNote, currentNote) &&
      topicMatches(candidate, topic)
  );
}

function sortCandidates(
  candidates: JsonObject[],
  strategy: string
): JsonObject[] {
  if (strategy === "newest")
    return [...candidates].sort(
      (a, b) =>
        (candidatePromptIndex(b) ?? -1) - (candidatePromptIndex(a) ?? -1)
    );
  if (strategy === "priority") {
    return [...candidates].sort((a, b) => {
      const weightDiff =
        (PRIORITY_WEIGHTS[b.type] || 0) - (PRIORITY_WEIGHTS[a.type] || 0);
      if (weightDiff !== 0) return weightDiff;
      return (candidatePromptIndex(b) ?? -1) - (candidatePromptIndex(a) ?? -1);
    });
  }
  return [...candidates].sort(
    (a, b) =>
      (candidatePromptIndex(a) ?? Number.MAX_SAFE_INTEGER) -
      (candidatePromptIndex(b) ?? Number.MAX_SAFE_INTEGER)
  );
}

function candidatePreview(candidate: JsonObject): JsonObject {
  return {
    candidate_id: candidate.candidate_id,
    title: candidate.title || "",
    type: candidate.type || "",
  };
}

function selectCandidates(
  candidates: JsonObject[],
  selection: string,
  strategy: string,
  maxOptions: number
): JsonObject {
  const ordered = sortCandidates(candidates, strategy);
  if (selection === "pick") {
    return {
      candidates: [],
      selected_candidate_ids: [],
      remaining_count: ordered.length,
      remaining_preview: [],
      pick_options: ordered.slice(0, maxOptions).map(candidatePreview),
    };
  }
  if (selection === "all") {
    return {
      candidates: ordered,
      selected_candidate_ids: ordered
        .map((candidate) => String(candidate.candidate_id))
        .filter(Boolean),
      remaining_count: 0,
      remaining_preview: [],
      experimental: true,
    };
  }
  const selected = ordered.slice(0, 1);
  const remaining = ordered.slice(1);
  return {
    candidates: selected,
    selected_candidate_ids: selected
      .map((candidate) => String(candidate.candidate_id))
      .filter(Boolean),
    remaining_count: remaining.length,
    remaining_preview: remaining.slice(0, maxOptions).map(candidatePreview),
  };
}

function commandParseModelOutput(args: string[]): number {
  const parsed = parseOptions(args, ["events", "provider", "model"]);
  const outputPath = parsed.positionals[0];
  if (!outputPath || !parsed.options.events)
    return usage(
      "parse-model-output <model-output.json> --events <events.jsonl> [--provider <name>] [--model <name>]"
    );
  const stdout = readFileSync(resolve(outputPath), "utf8");
  const eventsPath = resolve(parsed.options.events);
  const candidates = parseModelCandidates(
    stdout,
    loadJsonl(eventsPath),
    eventsPath,
    parsed.options.provider || "model",
    parsed.options.model || ""
  );
  process.stdout.write(JSON.stringify({ candidates }, null, 2) + "\n");
  return 0;
}

function commandCandidates(args: string[]): number {
  const parsed = parseOptions(args, [
    "events",
    "topic",
    "selection",
    "strategy",
    "max-options",
  ]);
  const candidatePath = parsed.positionals[0];
  if (!candidatePath)
    return usage(
      "candidates <note_candidates.jsonl> [--events <events.jsonl>] [--topic <topic>] [--selection auto|pick|all] [--strategy oldest|newest|priority] [--max-options <n>]"
    );
  const events = parsed.options.events
    ? loadJsonl(resolve(parsed.options.events))
    : [];
  const coverage = detectCoverage(events);
  const [previousNote, currentNote] = currentNoteWindow(events);
  const filtered = pendingCandidates(
    loadJsonl(resolve(candidatePath)),
    previousNote,
    currentNote,
    parsed.options.topic
  );
  const selection = parsed.options.selection || "auto";
  const strategy = parsed.options.strategy || "oldest";
  const maxOptions = Math.max(
    1,
    Number.parseInt(parsed.options["max-options"] || "5", 10) || 5
  );
  const selected = selectCandidates(filtered, selection, strategy, maxOptions);
  const result = {
    candidate_log_path: candidatePath,
    event_log_path: parsed.options.events || null,
    coverage,
    previous_note_index: previousNote,
    current_note_index: currentNote,
    topic: parsed.options.topic || null,
    topic_matched: parsed.options.topic ? filtered.length > 0 : null,
    should_check_event_window:
      Boolean(parsed.options.topic) && filtered.length === 0,
    selection,
    auto_pick_strategy: strategy,
    max_pick_options: maxOptions,
    ...selected,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

function markConsumed(
  records: JsonObject[],
  ids: Set<string>,
  notePath: string
): number {
  const consumedAt = utcNow();
  let changed = 0;
  for (const record of records) {
    if (!ids.has(String(record.candidate_id))) continue;
    if (record.status === "consumed" && record.note_path === notePath) continue;
    record.status = "consumed";
    record.consumed_at = consumedAt;
    record.note_path = notePath;
    changed += 1;
  }
  return changed;
}

function readEventRange(ref: JsonObject): JsonObject {
  const events = loadJsonl(resolve(String(ref.path)));
  const startIndex = Number.isInteger(ref.start_index) ? ref.start_index : 0;
  const endIndex = Number.isInteger(ref.end_index) ? ref.end_index : startIndex;
  return {
    source_ref: ref,
    events: events.slice(startIndex, endIndex + 1),
  };
}

function commandContext(args: string[]): number {
  const candidatePath = args[0];
  if (!candidatePath) return usage("context <candidate.json>");
  const candidate = JSON.parse(readFileSync(resolve(candidatePath), "utf8"));
  const refs = Array.isArray(candidate.source_refs)
    ? candidate.source_refs
    : [];
  const contexts = refs
    .filter((ref: JsonObject) => ref.kind === "event_range" && ref.path)
    .map(readEventRange);
  process.stdout.write(
    JSON.stringify(
      { candidate_id: candidate.candidate_id || null, contexts },
      null,
      2
    ) + "\n"
  );
  return 0;
}

function commandMarkConsumed(args: string[]): number {
  const parsed = parseOptions(args, ["ids", "note-path"]);
  const candidatePath = parsed.positionals[0];
  if (!candidatePath || !parsed.options.ids || !parsed.options["note-path"])
    return usage(
      "mark-consumed <note_candidates.jsonl> --ids <ids> --note-path <path>"
    );
  const records = loadJsonl(resolve(candidatePath));
  const ids = new Set(
    parsed.options.ids
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
  const changed = markConsumed(records, ids, parsed.options["note-path"]);
  writeJsonl(resolve(candidatePath), records);
  process.stdout.write(
    JSON.stringify({ changed, candidate_log_path: candidatePath }) + "\n"
  );
  return 0;
}

function parseOptions(
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

function commandMergeConfig(): number {
  process.stdout.write(JSON.stringify(loadConfig(), null, 2) + "\n");
  return 0;
}

function commandFindSession(args: string[]): number {
  const parsed = parseOptions(args, ["cwd"]);
  const targetCwd = parsed.options.cwd;
  if (!targetCwd) return usage("find-session --cwd <path>");
  const normalizedTarget = resolve(targetCwd).replace(/\/+$/, "");

  const sessionsDir = join(DATA_HOME, "sessions");
  if (!existsSync(sessionsDir)) {
    process.stdout.write(
      JSON.stringify({ session_id: "unknown", platform: "unknown" }) + "\n"
    );
    return 0;
  }

  const entries = readdirSync(sessionsDir);
  let bestMatch: {
    session_id: string;
    platform: string;
    cwd: string;
    timestamp: string;
  } | null = null;

  for (const entry of entries) {
    const eventsPath = join(sessionsDir, entry, "events.jsonl");
    const first = readFirstEvent(eventsPath);
    if (!first) continue;
    const eventCwd = resolve(String(first.cwd || "")).replace(/\/+$/, "");
    if (eventCwd !== normalizedTarget) continue;
    const timestamp = String(first.timestamp || "");
    // ISO 8601 timestamps sort lexicographically == chronologically
    if (!bestMatch || timestamp > bestMatch.timestamp) {
      bestMatch = {
        session_id: String(first.session_id || entry),
        platform: detectPlatform(String(first.transcript_path || "")),
        cwd: String(first.cwd || ""),
        timestamp,
      };
    }
  }

  if (bestMatch) {
    process.stdout.write(JSON.stringify(bestMatch, null, 2) + "\n");
  } else {
    process.stdout.write(
      JSON.stringify({ session_id: "unknown", platform: "unknown" }) + "\n"
    );
  }
  return 0;
}

function usage(message: string): number {
  process.stderr.write(`usage: note_distill_hook.ts ${message}\n`);
  return 2;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "collect") return commandCollect();
  if (command === "analyze") return commandAnalyze(args);
  if (command === "window") return commandWindow(args);
  if (command === "candidates") return commandCandidates(args);
  if (command === "parse-model-output") return commandParseModelOutput(args);
  if (command === "context") return commandContext(args);
  if (command === "mark-consumed") return commandMarkConsumed(args);
  if (command === "merge-config") return commandMergeConfig();
  if (command === "find-session") return commandFindSession(args);
  return usage(
    "collect|analyze|window|candidates|parse-model-output|context|mark-consumed|merge-config|find-session"
  );
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
