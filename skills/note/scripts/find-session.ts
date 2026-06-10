#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DATA_HOME,
  readFirstEvent,
  detectPlatform,
  parseOptions,
} from "../../../lib/nd-common.ts";

const parsed = parseOptions(process.argv.slice(2), ["cwd"]);
const targetCwd = parsed.options.cwd;
if (!targetCwd) {
  process.stderr.write("usage: find-session.ts --cwd <path>\n");
  process.exitCode = 2;
} else {
  const normalizedTarget = resolve(targetCwd).replace(/\/+$/, "");
  const sessionsDir = join(DATA_HOME, "sessions");
  if (!existsSync(sessionsDir)) {
    process.stdout.write(
      JSON.stringify({ session_id: "unknown", platform: "unknown" }) + "\n"
    );
    process.exitCode = 0;
  } else {
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
      if (!bestMatch || timestamp > bestMatch.timestamp) {
        bestMatch = {
          session_id: String(first.session_id || entry),
          platform: detectPlatform(String(first.transcript_path || "")),
          cwd: String(first.cwd || ""),
          timestamp,
        };
      }
    }

    process.stdout.write(
      bestMatch
        ? JSON.stringify(bestMatch, null, 2) + "\n"
        : JSON.stringify({ session_id: "unknown", platform: "unknown" }) + "\n"
    );
    process.exitCode = 0;
  }
}
