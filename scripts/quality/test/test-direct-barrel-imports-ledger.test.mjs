import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const fixture = "scripts/quality/test/fixtures/direct-barrel-ledger.fixture.mjs";

/** The environment of a CI shard, without any recorder of an enclosing run. */
function shardEnvironment(directory) {
  const {
    NODE_OPTIONS: _options,
    LERVO_CI_TEST_FILE: _file,
    LERVO_CI_TEST_LEDGER: _switch,
    GITHUB_ACTIONS: _actions,
    ...rest
  } = process.env;
  return { ...rest, LERVO_CI_TEST_LEDGER_DIRECTORY: directory };
}

it("keeps every barrel a rewrite consulted in the importing file's ledger closure", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "lervo-direct-barrel-ledger-"));
  try {
    const configuration = resolve(scratch, "vitest.config.mjs");
    const base = resolve(root, "vitest.config.ts");
    const library = new URL("../lib/ci-test-ledger-configuration.mjs", import.meta.url).href;
    // The repository's own plugins and aliases, without its global setup, which writes outputs.
    await writeFile(
      configuration,
      `import base from ${JSON.stringify(base)};
import { ciTestLedgerConfiguration } from ${JSON.stringify(library)};
export default { root: ${JSON.stringify(root)}, cacheDir: ${JSON.stringify(resolve(scratch, "cache"))}, plugins: base.plugins, resolve: base.resolve, test: { include: [${JSON.stringify(fixture)}], ...ciTestLedgerConfiguration() } };
`,
    );
    const run = spawnSync(
      process.execPath,
      [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "--config", configuration],
      { cwd: scratch, env: shardEnvironment(resolve(scratch, "ledger")), encoding: "utf8" },
    );
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const ledger = JSON.parse(
      await readFile(resolve(scratch, "ledger/ledger/ledger-shard-1-of-1.json"), "utf8"),
    );
    const [file] = ledger.files;
    expect(file).toMatchObject({ file: fixture, result: "passed" });
    // The worker loaded the declaring module, never the barrel or its other modules.
    const spool = resolve(scratch, "ledger/spool");
    const records = await Promise.all(
      (await readdir(spool)).map(async (name) =>
        JSON.parse(await readFile(resolve(spool, name), "utf8")),
      ),
    );
    const loaded = records.find((record) => record.file === fixture)?.modules;
    expect(loaded).toContain("packages/schemas/src/common.ts");
    expect(loaded).not.toContain("packages/schemas/src/index.ts");
    expect(loaded).not.toContain("packages/schemas/src/practice-event.ts");
    // Every module whose exports decided the rewrite is still an input of the file: the barrel,
    // and each star target, any of which could make the name ambiguous.
    const inputs = file.inputs.map((index) => ledger.paths[index]);
    for (const input of [
      "packages/schemas/src/index.ts",
      "packages/schemas/src/common.ts",
      "packages/schemas/src/practice-event.ts",
    ])
      expect(inputs).toContain(input);
    expect(file.uncacheableReasons).not.toContain("module_graph_unavailable");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 120_000);
