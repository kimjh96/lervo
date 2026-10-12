#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { runNodeRuntimeEntry } from "./entry.js";

process.exitCode = await runNodeRuntimeEntry(process.argv.slice(2), fileURLToPath(import.meta.url));
