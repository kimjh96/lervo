import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { CI_TEST_LEDGER_CONTRACT } from "../../lib/ci-test-ledger.mjs";
import { createCiTestEnvironmentScan } from "../../lib/ci-test-shadow-environment.mjs";
import { createCiTestInputIndex, readCiTestInputIndex } from "../../lib/ci-test-shadow-index.mjs";
import { createCiTestInputSnapshot } from "../../lib/ci-test-shadow-inputs.mjs";
import { predictCiTestReuse } from "../../lib/ci-test-shadow-prediction.mjs";
import { CI_TEST_RUN_UNIQUE_ENVIRONMENT } from "../../lib/ci-test-toolchain-digest.mjs";

export const hour = 60 * 60 * 1000;
export const now = Date.parse("2026-11-15T12:00:00Z");
export const G = "sha256:toolchain";
export const testFile = "packages/core/test/core.test.ts";
export const components = { lockfile: "sha256:lock", platform: "ubuntu24 20261111.370.1 x64" };
export const passed = { passed: 2, failed: 0, skipped: 0, pending: 0 };

/**
 * A temporary repository and the predictor around it: `record` builds one resolved ledger file,
 * `historyRun` indexes it against the tree as it is now, and `predict` asks the predictor at the
 * tree as it is then. Listing digests left empty are filled from the tree when indexed.
 */
export function createShadowHarness() {
  const root = mkdtempSync(resolve(tmpdir(), "lervo-ci-shadow-"));
  const write = (path, content = "") => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  const record = (overrides = {}) => ({
    file: testFile,
    shard: 1,
    observedAt: now - hour,
    contract: CI_TEST_LEDGER_CONTRACT,
    result: "passed",
    tests: passed,
    durationMs: 100,
    collectMs: 50,
    inputs: [],
    trees: [],
    absent: [],
    listings: [],
    dependencies: [],
    uncacheableReasons: [],
    toolchainDigest: G,
    toolchainComponents: components,
    ...overrides,
  });
  const historyRun = ({ id = "1", trusted = true, files = [record()], indexed = true } = {}) => {
    const snapshot = createCiTestInputSnapshot(root);
    for (const file of files)
      file.listings = file.listings.map(([path, kind, digests = []]) => [
        path,
        kind,
        digests.length > 0 ? digests : [snapshot.listing(path, kind === "recursive")],
      ]);
    const index = createCiTestInputIndex({
      run: { id, revision: "a".repeat(40) },
      files,
      snapshot,
    });
    return {
      run: { id, trusted, availableAt: now - hour / 2 },
      files: new Map(files.map((file) => [file.file, file])),
      index: indexed ? readCiTestInputIndex(JSON.parse(JSON.stringify(index))) : null,
    };
  };
  const predict = (entries, { toolchain = { digest: G, components }, complete = true } = {}) =>
    predictCiTestReuse({
      files: [{ file: testFile, toolchain }],
      history: { complete, entries },
      head: createCiTestInputSnapshot(root),
      environment: createCiTestEnvironmentScan(root, CI_TEST_RUN_UNIQUE_ENVIRONMENT),
      now,
    }).get(testFile);
  const remove = () => rmSync(root, { recursive: true, force: true });
  write(testFile, "test\n");
  return { root, write, record, historyRun, predict, remove };
}
