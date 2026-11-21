import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectIdleTimers } from "./lib/idle-timers.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const allowlist = JSON.parse(
  await readFile(resolve(repositoryRoot, "scripts/quality/idle-timer-allowlist.json"), "utf8"),
);
const result = await inspectIdleTimers({ repositoryRoot, allowlist });
if (result.issues.length > 0) {
  process.stderr.write(
    `Idle timer check failed (${result.issues.length}):\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Idle timer check passed (${result.files.length} resident and service files).\n`,
  );
}
