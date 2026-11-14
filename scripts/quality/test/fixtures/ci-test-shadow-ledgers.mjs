import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CI_TEST_LEDGER_CONTRACT } from "../../lib/ci-test-ledger.mjs";

export const SHADOW_TOOLCHAIN = "sha256:toolchain";

/** One shard ledger whose files each read the given repository paths. */
export function shadowLedger({ runId, revision, shard = 1, observedAt, files }) {
  const paths = [...new Set(files.flatMap((file) => [file.file, ...(file.inputs ?? [])]))];
  return {
    schemaVersion: 1,
    contract: CI_TEST_LEDGER_CONTRACT,
    run: { id: runId, attempt: "1", revision, observedAt, shard: { index: shard, count: 4 } },
    toolchain: { digest: SHADOW_TOOLCHAIN, components: {} },
    paths,
    files: files.map(({ file, result = "passed", inputs = [], tests }) => ({
      file,
      result,
      tests: tests ?? { passed: 1, failed: result === "failed" ? 1 : 0, skipped: 0, pending: 0 },
      durationMs: 1000,
      collectMs: 500,
      inputs: inputs.map((path) => paths.indexOf(path)),
      directories: [],
      trees: [],
      absent: [],
      uncacheableReasons: [],
      toolchainDigest: SHADOW_TOOLCHAIN,
    })),
  };
}

export async function writeShadowLedger(directory, ledger) {
  const shard = ledger.run.shard.index;
  const path = resolve(directory, `lervo-ci-test-ledger-${shard}`);
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, `ledger-shard-${shard}-of-4.json`), JSON.stringify(ledger));
}
