#!/usr/bin/env node
import { loadConfig } from "../../../lib/nd-common.ts";

const config = loadConfig();
process.stdout.write(JSON.stringify(config, null, 2) + "\n");
