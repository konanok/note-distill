#!/usr/bin/env node
import { resolve } from "node:path";
import {
  utcNow,
  loadJsonl,
  writeJsonl,
  parseOptions,
} from "../../../lib/nd-common.ts";

type JsonObject = Record<string, unknown>;

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

const args = process.argv.slice(2);
const parsed = parseOptions(args, ["ids", "note-path"]);
const candidatePath = parsed.positionals[0];
if (!candidatePath || !parsed.options.ids || !parsed.options["note-path"]) {
  process.stderr.write(
    "usage: mark-consumed.ts <note_candidates.jsonl> --ids <ids> --note-path <path>\n"
  );
  process.exitCode = 2;
} else {
  const records = loadJsonl(resolve(candidatePath));
  const ids = new Set(
    parsed.options.ids
      .split(",")
      .map((id: string) => id.trim())
      .filter(Boolean)
  );
  const changed = markConsumed(records, ids, parsed.options["note-path"]);
  writeJsonl(resolve(candidatePath), records);
  process.stdout.write(
    JSON.stringify({ changed, candidate_log_path: candidatePath }) + "\n"
  );
  process.exitCode = 0;
}
