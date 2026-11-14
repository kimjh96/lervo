import { CI_TEST_LEDGER_CONTRACT } from "./ci-test-ledger.mjs";

/**
 * Readers of downloaded shard ledgers (ADR-0565). Version 1 ledgers recorded neither writes nor
 * typed listings: their timings are still read, but their closures carry their contract so that
 * no reader compares them.
 */
const CI_TEST_LEDGER_CONTRACTS = new Set(["lervo-ci-test-ledger-v1", CI_TEST_LEDGER_CONTRACT]);

/** Reads `{ path: durationMs + collectMs }` for the files a ledger executed. */
export function readCiTestLedgerWeights(ledger) {
  if (!CI_TEST_LEDGER_CONTRACTS.has(ledger?.contract) || !Array.isArray(ledger.files))
    throw new Error("ci_test_ledger_invalid");
  const weights = new Map();
  for (const file of ledger.files) {
    if (!["passed", "failed"].includes(file.result)) continue;
    const weight = Number(file.durationMs) + Number(file.collectMs);
    if (typeof file.file === "string" && Number.isFinite(weight) && weight >= 0)
      weights.set(file.file, weight);
  }
  return weights;
}

/**
 * Resolves a ledger's files against its path table, for readers that compare closures. Each file
 * keeps its shard's observation time, so a reader can age every result separately.
 */
export function readCiTestLedgerFiles(ledger) {
  if (!CI_TEST_LEDGER_CONTRACTS.has(ledger?.contract) || !Array.isArray(ledger.files))
    throw new Error("ci_test_ledger_invalid");
  const paths = ledger.paths ?? [];
  const path = (id) => {
    if (!Number.isSafeInteger(id) || id < 0 || id >= paths.length)
      throw new Error("ci_test_ledger_invalid");
    return paths[id];
  };
  const observedAt = Date.parse(ledger.run?.observedAt ?? "");
  return ledger.files.map((file) => ({
    file: file.file,
    shard: ledger.run?.shard?.index ?? null,
    observedAt,
    result: file.result,
    tests: file.tests,
    durationMs: Number(file.durationMs) || 0,
    collectMs: Number(file.collectMs) || 0,
    inputs: (file.inputs ?? []).map(path),
    trees: (file.trees ?? []).map(path),
    absent: (file.absent ?? []).map(path),
    contract: ledger.contract,
    // A version 1 listing has no kind; readers must not compare it.
    listings: (file.listings ?? []).map(([id, kind, ...digests]) => [path(id), kind, digests]),
    dependencies: (file.dependencies ?? []).map(path),
    uncacheableReasons: file.uncacheableReasons ?? [],
    toolchainDigest: file.toolchainDigest ?? null,
    toolchainComponents: ledger.toolchain?.components ?? null,
  }));
}
