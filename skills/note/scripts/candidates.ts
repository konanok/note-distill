#!/usr/bin/env node
import { resolve } from "node:path";
import {
  PRIORITY_WEIGHTS,
  loadJsonl,
  parseOptions,
  detectCoverage,
  currentNoteWindow,
} from "../../../lib/nd-common.ts";

type JsonObject = Record<string, unknown>;

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

const args = process.argv.slice(2);
const parsed = parseOptions(args, [
  "events",
  "topic",
  "selection",
  "strategy",
  "max-options",
]);
const candidatePath = parsed.positionals[0];
if (!candidatePath) {
  process.stderr.write(
    "usage: candidates.ts <note_candidates.jsonl> [--events <events.jsonl>] [--topic <topic>] [--selection auto|pick|all] [--strategy oldest|newest|priority] [--max-options <n>]\n"
  );
  process.exitCode = 2;
} else {
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
  process.exitCode = 0;
}
