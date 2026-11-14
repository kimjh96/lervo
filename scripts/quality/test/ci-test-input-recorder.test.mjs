import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { createCiTestLedger } from "../lib/ci-test-ledger.mjs";

const program = resolve(import.meta.dirname, "fixtures/ci-test-input-program.mjs");
const programPath = "scripts/quality/test/fixtures/ci-test-input-program.mjs";
const recorder = resolve(import.meta.dirname, "../lib/ci-test-input-recorder.cjs");
const testFile = "scripts/quality/test/recorded-sample.test.mjs";
let scratch;

beforeEach(async () => {
  scratch = await mkdtemp(resolve(tmpdir(), "lervo-ci-recorder-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A clean environment, so an outer recorder running these tests does not mix in. */
function environment(overrides = {}) {
  const {
    NODE_OPTIONS: _options,
    LERVO_CI_TEST_LEDGER: _switch,
    LERVO_CI_TEST_LEDGER_DIRECTORY: _directory,
    LERVO_CI_TEST_FILE: _file,
    ...rest
  } = process.env;
  return {
    ...rest,
    NODE_OPTIONS: `--require=${JSON.stringify(recorder)}`,
    LERVO_CI_TEST_LEDGER_DIRECTORY: resolve(scratch, "ledger"),
    LERVO_CI_TEST_FILE: testFile,
    ...overrides,
  };
}

async function spool() {
  const directory = resolve(scratch, "ledger/spool");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(resolve(directory, name), "utf8"))),
  );
}

it("records reads, listings, absent probes, modules, children, sockets, SQLite and the clock", async () => {
  execFileSync(process.execPath, [program, "all"], { cwd: scratch, env: environment() });
  const records = await spool();
  const main = records.find((record) => record.invocation.at(-1) === "all");
  expect(main).toMatchObject({ file: testFile, role: "process", final: true, truncated: false });
  for (const input of [
    "package.json",
    "README.md",
    "docs",
    programPath,
    "scripts/quality/lib/generated-text.mjs",
    "scripts/quality/ci-test-durations.json",
  ])
    expect(main.inputs).toContain(input);
  expect(Object.keys(main.directories)).toEqual(["scripts/quality"]);
  expect(main.directories["scripts/quality"][0]).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(main.absent).toContain("scripts/quality/absent-recorder-probe.mjs");
  expect(main.dependencies.some((key) => key.startsWith("pnpm:yaml@"))).toBe(true);
  expect(main.inputs.some((input) => input.includes("lervo-recorder-program-"))).toBe(false);
  expect(main.counts.temporary).toBeGreaterThan(0);
  expect(main.host).toEqual(["~/.lervo-ci-recorder-absent-probe"]);
  expect(main.counts).toMatchObject({ clockNow: 1, clockConstruct: 1, sqliteOpened: 2 });
  expect(main.sqlite).toEqual(["<temporary>"]);
  expect(main.counts.loopback).toBeGreaterThanOrEqual(1);
  expect(main.external).toEqual(["192.0.2.1:9"]);

  // Children that can never have a record collapse into one entry per identical command.
  const children = main.children.map(({ command, pid, inherited, failed, cwd, count }) =>
    [command, pid === null ? "no pid" : "pid", inherited, failed, cwd, count].join(" "),
  );
  expect(children).toEqual([
    "node no pid true false <temporary> 1",
    "node pid true false <temporary> 1",
    "node no pid false false <temporary> 1",
    "git no pid true false . 1",
    "git no pid true false <temporary> 3",
    "missing-executable no pid true true <temporary> 1",
  ]);
  const childRecords = records.filter((record) => record.invocation.at(-1) === "child");
  expect(childRecords).toHaveLength(2);
  for (const child of childRecords) {
    expect(child).toMatchObject({ ppid: main.pid, file: testFile, final: true });
    expect(child.inputs).toContain("pnpm-workspace.yaml");
  }

  // Treat the program as the file's worker to isolate the other reasons.
  main.role = "worker";
  const tracked = new Set(records.flatMap((record) => record.inputs));
  const ledger = createCiTestLedger({
    results: [{ file: testFile, result: "passed", tests: {}, durationMs: 5, collectMs: 7 }],
    records,
    tracked,
    generated: new Map(),
    workspaces: new Map(),
    toolchain: { digest: "sha256:toolchain", components: {} },
    run: { id: "local" },
  });
  const [file] = ledger.files;
  expect(file.uncacheableReasons).toEqual([
    "unobserved_child",
    "git_in_repository",
    "network",
    "host_state",
  ]);
  expect(file.children).toMatchObject({
    spawned: 8,
    observed: 2,
    failed: 1,
    gitInRepository: 1,
    gitOutsideRepository: 3,
  });
  expect(Object.values(file.children.unobserved)).toEqual([1]);
  expect(file.inputs.map((index) => ledger.paths[index])).toContain("pnpm-workspace.yaml");
});

it("keeps every result and failure identical with the recorder on", () => {
  const run = (env) =>
    execFileSync(process.execPath, [program, "results"], { cwd: scratch, env, encoding: "utf8" });
  const recorded = run(environment());
  const { NODE_OPTIONS: _options, ...plain } = environment();
  expect(recorded).toBe(run(plain));
  expect(JSON.parse(recorded)).toMatchObject({ stream: true, missingStream: "ENOENT" });
  expect(JSON.parse(recorded)).toMatchObject({
    exists: false,
    stat: true,
    date: true,
    constructor: true,
  });
});

it("spools a final record on SIGTERM and still exits by that signal", async () => {
  const child = spawn(process.execPath, [program, "wait"], {
    cwd: scratch,
    env: environment(),
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((done) => child.stdout.once("data", done));
  child.kill("SIGTERM");
  const [code, signal] = await new Promise((done) =>
    child.on("exit", (...outcome) => done(outcome)),
  );
  expect({ code, signal }).toEqual({ code: null, signal: "SIGTERM" });
  const [record] = await spool();
  expect(record).toMatchObject({ pid: child.pid, final: true });
  expect(record.inputs).toContain("tsconfig.json");
});

it("stays inert when the repository variable switches the ledger off", () => {
  const result = spawnSync(process.execPath, [program, "results"], {
    cwd: scratch,
    env: environment({ LERVO_CI_TEST_LEDGER: "off" }),
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(existsSync(resolve(scratch, "ledger"))).toBe(false);
  const missingDirectory = spawnSync(process.execPath, [program, "results"], {
    cwd: scratch,
    env: environment({ LERVO_CI_TEST_LEDGER_DIRECTORY: "" }),
    encoding: "utf8",
  });
  expect(missingDirectory.stdout).toBe(result.stdout);
  expect(existsSync(resolve(scratch, "ledger"))).toBe(false);
});
