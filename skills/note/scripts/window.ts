#!/usr/bin/env node
import { resolve } from "node:path";
import {
  loadJsonl,
  extractWindow,
  sessionPath,
} from "../../../lib/nd-common.ts";

const args = process.argv.slice(2);

let eventsPath: string | undefined;

if (args[0] === "--session-id" && args[1]) {
  eventsPath = sessionPath(args[1], "events.jsonl");
} else {
  eventsPath = args[0];
}

if (!eventsPath) {
  process.stderr.write(
    "usage: window.ts <events.jsonl> | window.ts --session-id <session-id>\n"
  );
  process.exitCode = 2;
} else {
  process.stdout.write(
    JSON.stringify(extractWindow(loadJsonl(resolve(eventsPath))), null, 2) +
      "\n"
  );
}
