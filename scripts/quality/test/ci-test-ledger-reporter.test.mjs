import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { expect, it, vi } from "vitest";

import base from "../../../vitest.config.ts";
import ciConfiguration from "../ci-vitest.config.mjs";
import { ciTestLedgerConfiguration } from "../lib/ci-test-ledger-configuration.mjs";
import CiTestLedgerReporter from "../lib/ci-test-ledger-reporter.mjs";
import CiTestSequencer from "../lib/ci-test-sequencer.mjs";

const root = resolve(import.meta.dirname, "../../..");
const fixture = "scripts/quality/test/fixtures/ci-test-ledger-sample.fixture.mjs";

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

it("writes one bounded ledger for a real Vitest run with the recorder on", async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), "lervo-ci-ledger-run-"));
  try {
    const configuration = resolve(scratch, "vitest.config.mjs");
    const library = new URL("../lib/ci-test-ledger-configuration.mjs", import.meta.url).href;
    await writeFile(
      configuration,
      `import { ciTestLedgerConfiguration } from ${JSON.stringify(library)};
export default { root: ${JSON.stringify(root)}, cacheDir: ${JSON.stringify(resolve(scratch, "cache"))}, test: { include: [${JSON.stringify(fixture)}], ...ciTestLedgerConfiguration() } };
`,
    );
    const run = spawnSync(
      process.execPath,
      [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "--config", configuration],
      // The nested run has no recorder of the enclosing one, so it starts and caches in its scratch
      // directory; its root is explicit, and nothing it writes lands in the repository.
      { cwd: scratch, env: shardEnvironment(resolve(scratch, "ledger")), encoding: "utf8" },
    );
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toMatch(
      /CI test ledger: 1 files, [01] with a complete closure, \d+ process records/u,
    );
    const ledger = JSON.parse(
      await readFile(resolve(scratch, "ledger/ledger/ledger-shard-1-of-1.json"), "utf8"),
    );
    expect(ledger.toolchain.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const [file] = ledger.files;
    const inputs = file.inputs.map((index) => ledger.paths[index]);
    expect(file).toMatchObject({
      file: fixture,
      result: "passed",
      tests: { passed: 1, failed: 0, skipped: 0, pending: 0 },
      clock: { now: 1, construct: 1 },
      toolchainDigest: ledger.toolchain.digest,
    });
    expect(file.collectMs).toBeGreaterThan(0);
    for (const input of [fixture, "package.json", "pnpm-workspace.yaml"])
      expect(inputs).toContain(input);
    // The worker fetches repository modules from Vitest over RPC; the ledger still lists them.
    expect(inputs).toContain("scripts/quality/lib/generated-text.mjs");
    expect(file.children).toMatchObject({ spawned: 1, observed: 1, unobserved: {} });
    expect(file.processes.complete).toBeGreaterThanOrEqual(2);
    expect(file.uncacheableReasons).not.toContain("module_graph_unavailable");
    expect(file.uncacheableReasons).not.toContain("unobserved_child");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);

it("never fails the run when the ledger cannot be written", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const reporter = new CiTestLedgerReporter({ directory: "/dev/null/lervo-ci-test-ledger" });
    reporter.onInit({ config: { root, setupFiles: [], globalSetup: [] } });
    await expect(reporter.onTestRunEnd([])).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/^CI test ledger not written: /u));
  } finally {
    write.mockRestore();
  }
  expect(existsSync("/dev/null/lervo-ci-test-ledger")).toBe(false);
});

it("turns the ledger on only for an absolute directory and keeps Vitest's own reporters", () => {
  for (const environment of [
    {},
    { LERVO_CI_TEST_LEDGER_DIRECTORY: "relative/ledger" },
    { LERVO_CI_TEST_LEDGER: "off", LERVO_CI_TEST_LEDGER_DIRECTORY: "/tmp/ledger" },
  ])
    expect(ciTestLedgerConfiguration(environment)).toEqual({});
  const on = ciTestLedgerConfiguration({
    LERVO_CI_TEST_LEDGER: "on",
    LERVO_CI_TEST_LEDGER_DIRECTORY: "/tmp/ledger",
    NODE_OPTIONS: "--max-old-space-size=4096",
  });
  expect(on.env.NODE_OPTIONS).toMatch(
    /^--max-old-space-size=4096 --require="\/.+\/scripts\/quality\/lib\/ci-test-input-recorder\.cjs"$/u,
  );
  expect(on.setupFiles).toEqual([resolve(root, "scripts/quality/lib/ci-test-input-binding.mjs")]);
  expect(on.reporters.slice(0, -1)).toEqual(["default"]);
  expect(on.reporters.at(-1)).toBeInstanceOf(CiTestLedgerReporter);
  const actions = ciTestLedgerConfiguration({
    LERVO_CI_TEST_LEDGER_DIRECTORY: "/tmp/ledger",
    GITHUB_ACTIONS: "true",
  });
  expect(actions.reporters.slice(0, -1)).toEqual(["default", "github-actions"]);
  expect(actions.env.NODE_OPTIONS.startsWith("--require=")).toBe(true);
});

it("leaves test selection, setup and placement of the CI configuration unchanged", () => {
  expect(ciConfiguration.test.include).toEqual(base.test.include);
  expect(ciConfiguration.test.globalSetup).toEqual(base.test.globalSetup);
  expect(ciConfiguration.test.setupFiles.slice(0, base.test.setupFiles.length)).toEqual(
    base.test.setupFiles,
  );
  expect(ciConfiguration.test.sequence.sequencer).toBe(CiTestSequencer);
  expect(ciConfiguration.test.shard).toBeUndefined();
});
