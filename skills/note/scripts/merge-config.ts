#!/usr/bin/env node
import {
  loadConfig,
  resolveModel,
  parseOptions,
} from "../../../lib/nd-common.ts";

const args = process.argv.slice(2);
const parsed = parseOptions(args, ["platform"]);
const config = loadConfig();

// Resolve subagent model if platform is provided
const platform = parsed.options.platform;
if (platform) {
  const model = (config.subagent as Record<string, unknown>)?.model || "haiku";
  config.subagent_resolved_model = resolveModel(String(model), platform, config);
}

process.stdout.write(JSON.stringify(config, null, 2) + "\n");
