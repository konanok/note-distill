#!/usr/bin/env node
import { resolve } from "node:path";
import { loadJsonl, extractWindow } from "../../../lib/nd-common.ts";

const eventsPath = process.argv[2];
if (!eventsPath) {
  process.stderr.write("usage: window.ts <events.jsonl>\n");
  process.exitCode = 2;
} else {
  process.stdout.write(
    JSON.stringify(extractWindow(loadJsonl(resolve(eventsPath))), null, 2) +
      "\n"
  );
}
