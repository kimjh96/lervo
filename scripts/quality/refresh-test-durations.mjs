import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

import {
  createCiTestDurationProfile,
  createCiTestWeightProfile,
  parseVitestModuleDurations,
  readCiTestDurationProfile,
} from "./lib/ci-test-duration-profile.mjs";
import { readCiTestLedgerRun } from "./lib/ci-test-ledger-runs.mjs";
import { downloadCiTestLedgerRuns, findCiTestLedgerRuns } from "./lib/ci-test-ledger-sources.mjs";

/**
 * Rewrites the CI timing profile. From the test ledgers of the newest full CI runs (ADR-0565),
 * found and downloaded with the GitHub CLI:
 *   node scripts/quality/refresh-test-durations.mjs --from-ci [--window 5]
 * From test ledgers already downloaded, one directory per full run:
 *   gh run download <run> --pattern 'lervo-ci-test-ledger-*' --dir runs/<run>
 *   node scripts/quality/refresh-test-durations.mjs --ledgers runs/<run> runs/<older run> ...
 * Or, without ledgers, from one full run's test logs:
 *   gh run view <run> --log > run.log
 *   node scripts/quality/refresh-test-durations.mjs --run <run> --revision <sha> run.log
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "from-ci": { type: "boolean" },
    ledgers: { type: "boolean" },
    window: { type: "string", default: "5" },
    run: { type: "string" },
    revision: { type: "string" },
  },
});
const profilePath = resolve(import.meta.dirname, "ci-test-durations.json");
const observedAt = new Date().toISOString().slice(0, 10);
const window = Number(values.window);
const execFileAsync = promisify(execFile);

async function profileFromLedgers(directories) {
  if (directories.length === 0) throw new Error("ci_duration_ledgers_empty");
  const runs = [];
  for (const directory of directories) runs.push(await readCiTestLedgerRun(directory));
  return createCiTestWeightProfile({
    runs,
    current: readCiTestDurationProfile(JSON.parse(await readFile(profilePath, "utf8"))),
    window,
    observedAt,
  });
}

async function profileFromCi() {
  const gh = async (args) =>
    (await execFileAsync("gh", args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  const runIds = await findCiTestLedgerRuns({ gh, count: window });
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-ci-test-ledgers-"));
  try {
    return await profileFromLedgers(await downloadCiTestLedgerRuns({ gh, runIds, directory }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

let profile;
if (values["from-ci"]) {
  if (positionals.length > 0) throw new Error("ci_duration_source_invalid");
  profile = await profileFromCi();
} else if (values.ledgers) {
  profile = await profileFromLedgers(positionals);
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
const sources = profile.sources?.map(({ runId }) => runId) ?? [profile.sourceRunId];
process.stdout.write(
  `${JSON.stringify({ schemaVersion: profile.schemaVersion, sources, keptFiles: kept.length, smallestKeptMs: Math.min(...kept), defaultWeight: profile.defaultWeight ?? 1500 })}\n`,
);
