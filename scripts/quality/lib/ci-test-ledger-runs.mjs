import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { readCiTestLedgerWeights } from "./ci-test-ledger-read.mjs";

async function ledgerFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /^ledger-shard-\d+-of-\d+\.json$/u.test(entry.name))
    .map((entry) => resolve(entry.parentPath, entry.name));
}

/**
 * Reads one run's downloaded shard ledgers (ADR-0565), sorted by shard. Every ledger must name the
 * same run, so ledgers of different runs never mix.
 */
export async function readCiTestLedgers(directory) {
  const ledgers = [];
  for (const path of await ledgerFiles(directory))
    ledgers.push(JSON.parse(await readFile(path, "utf8")));
  if (ledgers.length === 0) throw new Error("ci_duration_ledgers_empty");
  const [{ run }] = ledgers;
  if (!/^\d+$/u.test(run?.id ?? "") || ledgers.some((ledger) => ledger.run?.id !== run.id))
    throw new Error("ci_duration_source_invalid");
  return ledgers.sort((left, right) => left.run.shard.index - right.run.shard.index);
}

/**
 * Reads one run's downloaded shard ledgers as `{ runId, revision, complete, weights }`.
 * `complete` says every shard's ledger is present, so a file missing from the run no longer exists.
 */
export async function readCiTestLedgerRun(directory) {
  const ledgers = await readCiTestLedgers(directory);
  const [{ run }] = ledgers;
  const weights = new Map();
  for (const ledger of ledgers)
    for (const [path, weight] of readCiTestLedgerWeights(ledger)) weights.set(path, weight);
  const shards = new Set(ledgers.map((ledger) => ledger.run.shard.index));
  return {
    runId: run.id,
    revision: run.revision,
    complete: shards.size === run.shard.count,
    weights,
  };
}
