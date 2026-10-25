#!/usr/bin/env node

import { createProcessObserver } from "@lervo/node-work-admission";
import { bindInstalledRuntimeProcess } from "@lervo/runtime-security";
import { fileURLToPath } from "node:url";
import { runNodeRuntimeEntry } from "./entry.js";

const executable = fileURLToPath(import.meta.url);
const observeProcess = createProcessObserver();
const releaseRuntime = await bindInstalledRuntimeProcess(executable, {
  processIdentity: () => {
    const observed = observeProcess(process.pid);
    return observed.status === "present" ? observed.identity : null;
  },
}).catch(() => async () => {});
try {
  process.exitCode = await runNodeRuntimeEntry(process.argv.slice(2), executable);
} finally {
  await releaseRuntime().catch(() => undefined);
}
