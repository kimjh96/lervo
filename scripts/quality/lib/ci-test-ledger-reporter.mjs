import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { readBundleMetafile, readSchemaValidatorManifest } from "./ci-test-build-output-map.mjs";
import { createCiTestLedger } from "./ci-test-ledger.mjs";
import {
  computeCiTestToolchainDigest,
  observeCiTestToolchain,
} from "./ci-test-toolchain-digest.mjs";

/**
 * Vitest reporter that writes the shard's test input ledger (ADR-0565) after the run. It only
 * observes: it never throws, never changes the exit code, and a failure leaves a one-line notice
 * instead of a ledger. The ledger stays bounded; beyond the byte limit it keeps results and reasons
 * and drops the per-file path lists.
 */
const maximumLedgerBytes = 32 * 1024 * 1024;
const BUNDLE_METAFILE = "apps/cli/dist/bin.metafile.json";
const SCHEMA_VALIDATORS = "packages/schemas/dist/generated";
const SCHEMA_VALIDATOR_OUTPUTS = [
  "validators.js",
  "selected-validators.js",
  "coordinate-data-validators.js",
  "manifest.json",
];

const repositoryPath = (root, path) => relative(root, path).split("\\").join("/");

function resultOf(root, testModule) {
  const tests = { passed: 0, failed: 0, skipped: 0, pending: 0 };
  for (const test of testModule.children.allTests()) {
    const state = test.result().state;
    tests[state in tests ? state : "pending"] += 1;
  }
  const diagnostic = testModule.diagnostic();
  return {
    file: repositoryPath(root, testModule.moduleId),
    result: testModule.state(),
    tests,
    durationMs: Math.round(diagnostic.duration),
    collectMs: Math.round(diagnostic.collectDuration),
  };
}

async function readSpool(directory) {
  const records = [];
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    try {
      records.push(JSON.parse(await readFile(resolve(directory, name), "utf8")));
    } catch {
      // A record cut off mid-write leaves its process unobserved.
    }
  }
  return records;
}

async function readWorkspaces(root, tracked) {
  const workspaces = new Map();
  for (const path of tracked) {
    if (!/^(?:apps|packages)\/[^/]+\/package\.json$/u.test(path)) continue;
    const { name } = JSON.parse(await readFile(resolve(root, path), "utf8"));
    if (typeof name === "string") workspaces.set(name, path.slice(0, -"/package.json".length));
  }
  return workspaces;
}

/** Generated outputs whose generators record their sources; a missing record maps nothing. */
async function readGeneratedOutputs(root) {
  const read = async (path) => {
    try {
      return JSON.parse(await readFile(resolve(root, path), "utf8"));
    } catch {
      return null;
    }
  };
  return new Map([
    ...readBundleMetafile(await read(BUNDLE_METAFILE)),
    ...readSchemaValidatorManifest(
      await read(`${SCHEMA_VALIDATORS}/manifest.json`),
      SCHEMA_VALIDATORS,
      SCHEMA_VALIDATOR_OUTPUTS,
    ),
  ]);
}

/** Drops per-file path lists while keeping results, reasons and counts. */
function reduce(ledger) {
  return {
    ...ledger,
    reduced: true,
    paths: [],
    buildOutputs: [],
    unmappedBuildOutputs: [],
    files: ledger.files.map((file) => ({
      ...file,
      inputs: [],
      listings: [],
      trees: [],
      absent: [],
      dependencies: [],
      untracked: [],
      uncacheableReasons: [...new Set([...file.uncacheableReasons, "module_graph_unavailable"])],
    })),
  };
}

export default class CiTestLedgerReporter {
  #directory;
  #vitest;

  constructor({ directory }) {
    this.#directory = directory;
  }

  onInit(vitest) {
    this.#vitest = vitest;
  }

  async onTestRunEnd(testModules) {
    try {
      await this.#write(testModules);
    } catch (error) {
      process.stdout.write(`CI test ledger not written: ${error?.message ?? error}\n`);
    }
  }

  async #write(testModules) {
    const { config } = this.#vitest;
    const root = config.root;
    const git = (args) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const tracked = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
    const setupFiles = [...(config.setupFiles ?? []), ...(config.globalSetup ?? [])]
      .map((path) => repositoryPath(root, path))
      .filter((path) => tracked.has(path));
    const shard = config.shard ?? { index: 1, count: 1 };
    const ledger = createCiTestLedger({
      results: testModules.map((testModule) => resultOf(root, testModule)),
      records: await readSpool(resolve(this.#directory, "spool")),
      tracked,
      generated: await readGeneratedOutputs(root),
      workspaces: await readWorkspaces(root, tracked),
      toolchain: {
        ...(await computeCiTestToolchainDigest({ repositoryRoot: root, tracked, setupFiles })),
        observed: observeCiTestToolchain(),
      },
      run: {
        id: process.env.GITHUB_RUN_ID ?? "local",
        attempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
        revision: git(["rev-parse", "HEAD"]).trim(),
        observedAt: new Date().toISOString(),
        shard: { index: shard.index, count: shard.count },
      },
    });
    let text = JSON.stringify(ledger);
    if (Buffer.byteLength(text) > maximumLedgerBytes) text = JSON.stringify(reduce(ledger));
    const output = resolve(this.#directory, "ledger");
    await mkdir(output, { recursive: true });
    const name = `ledger-shard-${shard.index}-of-${shard.count}.json`;
    await writeFile(resolve(output, name), `${text}\n`);
    const { summary } = ledger;
    process.stdout.write(
      `CI test ledger: ${summary.files} files, ${summary.cacheable} with a complete closure, ` +
        `${summary.records} process records, ${Buffer.byteLength(text)} bytes in ${name}\n`,
    );
  }
}
