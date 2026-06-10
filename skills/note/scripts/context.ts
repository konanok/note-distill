#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadJsonl } from "../../../lib/nd-common.ts";

type JsonObject = Record<string, unknown>;

function readEventRange(ref: JsonObject): JsonObject {
  const events = loadJsonl(resolve(String(ref.path)));
  const startIndex = Number.isInteger(ref.start_index) ? ref.start_index : 0;
  const endIndex = Number.isInteger(ref.end_index) ? ref.end_index : startIndex;
  return {
    source_ref: ref,
    events: events.slice(startIndex, endIndex + 1),
  };
}

const candidatePath = process.argv[2];
if (!candidatePath) {
  process.stderr.write("usage: context.ts <candidate.json>\n");
  process.exitCode = 2;
} else {
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
}
