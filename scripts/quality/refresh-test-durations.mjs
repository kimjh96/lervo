import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createCiTestDurationProfile,
  createCiTestWeightProfile,
  parseVitestModuleDurations,
  readCiTestDurationProfile,
} from "./lib/ci-test-duration-profile.mjs";
import { readCiTestLedgerRun } from "./lib/ci-test-ledger-runs.mjs";

/**
 * Rewrites the CI timing profile. From test ledgers (ADR-0565), one directory per full run:
 *   gh run download <run> --pattern 'lervo-ci-test-ledger-*' --dir runs/<run>
 *   node scripts/quality/refresh-test-durations.mjs --ledgers runs/<run> runs/<older run> ...
 * Or, without ledgers, from one full run's test logs:
 *   gh run view <run> --log > run.log
 *   node scripts/quality/refresh-test-durations.mjs --run <run> --revision <sha> run.log
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ledgers: { type: "boolean" },
    window: { type: "string", default: "5" },
    run: { type: "string" },
    revision: { type: "string" },
  },
});
const profilePath = resolve(import.meta.dirname, "ci-test-durations.json");
const observedAt = new Date().toISOString().slice(0, 10);

let profile;
if (values.ledgers) {
  if (positionals.length === 0) throw new Error("ci_duration_ledgers_empty");
  const runs = [];
  for (const directory of positionals) runs.push(await readCiTestLedgerRun(directory));
  profile = createCiTestWeightProfile({
    runs,
    current: readCiTestDurationProfile(JSON.parse(await readFile(profilePath, "utf8"))),
    window: Number(values.window),
    observedAt,
  });
} else {
  if (!/^\d+$/u.test(values.run ?? "") || !/^[a-f0-9]{40}$/u.test(values.revision ?? ""))
    throw new Error("ci_duration_source_invalid");
  if (positionals.length === 0) throw new Error("ci_duration_log_missing");
  let text = "";
  for (const path of positionals) text += `${await readFile(path, "utf8")}\n`;
  const durations = parseVitestModuleDurations(text);
  if (durations.size === 0) throw new Error("ci_duration_log_empty");
  profile = createCiTestDurationProfile({
    durations,
    source: { runId: values.run, revision: values.revision, observedAt },
  });
}
await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
const kept = Object.values(profile.weights ?? profile.durations);
process.stdout.write(
  `${JSON.stringify({ schemaVersion: profile.schemaVersion, keptFiles: kept.length, smallestKeptMs: Math.min(...kept), defaultWeight: profile.defaultWeight ?? 1500 })}\n`,
);
