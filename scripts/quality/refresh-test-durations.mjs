import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createCiTestDurationProfile,
  parseVitestModuleDurations,
} from "./lib/ci-test-duration-profile.mjs";

/**
 * Rewrites the CI timing profile from one full Code quality run's test logs:
 *   gh run view <run> --log > run.log
 *   node scripts/quality/refresh-test-durations.mjs --run <run> --revision <sha> run.log
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { run: { type: "string" }, revision: { type: "string" } },
});
if (!/^\d+$/u.test(values.run ?? "") || !/^[a-f0-9]{40}$/u.test(values.revision ?? ""))
  throw new Error("ci_duration_source_invalid");
if (positionals.length === 0) throw new Error("ci_duration_log_missing");
let text = "";
for (const path of positionals) text += `${await readFile(path, "utf8")}\n`;
const durations = parseVitestModuleDurations(text);
if (durations.size === 0) throw new Error("ci_duration_log_empty");
const profile = createCiTestDurationProfile({
  durations,
  source: {
    runId: values.run,
    revision: values.revision,
    observedAt: new Date().toISOString().slice(0, 10),
  },
});
await writeFile(
  resolve(import.meta.dirname, "ci-test-durations.json"),
  `${JSON.stringify(profile, null, 2)}\n`,
);
const kept = Object.values(profile.durations);
process.stdout.write(
  `${JSON.stringify({
    parsedFiles: durations.size,
    keptFiles: kept.length,
    smallestKeptMs: Math.min(...kept),
  })}\n`,
);
