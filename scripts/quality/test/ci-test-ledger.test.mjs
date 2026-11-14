import { expect, it } from "vitest";

import {
  readBundleMetafile,
  readSchemaValidatorManifest,
} from "../lib/ci-test-build-output-map.mjs";
import {
  CI_TEST_LEDGER_CONTRACT,
  CI_TEST_UNCACHEABLE_REASONS,
  createCiTestLedger,
} from "../lib/ci-test-ledger.mjs";
import { readCiTestLedgerFiles, readCiTestLedgerWeights } from "../lib/ci-test-ledger-read.mjs";

const toolchain = { digest: "sha256:toolchain", components: { lockfile: "sha256:lock" } };

function worker(file, overrides = {}) {
  return {
    pid: 100,
    ppid: 1,
    threadId: 0,
    role: "worker",
    invocation: ["<pnpm:tinypool@1.1.1>"],
    file,
    end: "exit",
    inputs: [],
    modules: [],
    absent: [],
    listings: {},
    writes: [],
    trees: [],
    dependencies: [],
    host: [],
    children: [],
    external: [],
    counts: {},
    notes: [],
    truncated: false,
    ...overrides,
  };
}

const result = (file, overrides = {}) => ({
  file,
  result: "passed",
  tests: { passed: 1, failed: 0, skipped: 0, pending: 0 },
  durationMs: 10,
  collectMs: 20,
  ...overrides,
});

function ledgerOf(records, { tracked = [], generated = new Map(), workspaces = new Map() } = {}) {
  return createCiTestLedger({
    results: [...new Set(records.map((record) => record.file).filter(Boolean))].map((file) =>
      result(file),
    ),
    records,
    tracked: new Set(tracked),
    generated,
    workspaces,
    toolchain,
    run: { id: "1", shard: { index: 1, count: 4 } },
  });
}

const reasonsOf = (records, options) =>
  Object.fromEntries(
    ledgerOf(records, options).files.map((file) => [file.file, file.uncacheableReasons]),
  );

it("stores each path once and lists every file's closure by index", () => {
  const tracked = ["shared.ts", "a.ts", "b.ts", "docs"];
  const ledger = ledgerOf(
    [
      worker("a.test.ts", {
        inputs: ["shared.ts", "a.ts"],
        listings: { docs: { plain: "sha256:1", recursive: "sha256:2" } },
      }),
      worker("b.test.ts", { pid: 101, inputs: ["shared.ts", "b.ts"], modules: ["a.ts"] }),
    ],
    { tracked: [...tracked, "a.test.ts", "b.test.ts", "docs/x.md"] },
  );
  expect(ledger).toMatchObject({ schemaVersion: 1, contract: CI_TEST_LEDGER_CONTRACT, toolchain });
  expect(new Set(ledger.paths).size).toBe(ledger.paths.length);
  const [a, b] = ledger.files;
  expect(a.inputs.map((index) => ledger.paths[index])).toEqual(["a.ts", "shared.ts"]);
  expect(b.inputs.map((index) => ledger.paths[index])).toEqual(["a.ts", "b.ts", "shared.ts"]);
  // Plain and recursive listings stay apart, each with its kind.
  expect(a.listings).toEqual([
    [ledger.paths.indexOf("docs"), "plain", "sha256:1"],
    [ledger.paths.indexOf("docs"), "recursive", "sha256:2"],
  ]);
  expect(readCiTestLedgerFiles(ledger)[0].listings).toEqual([
    ["docs", "plain", ["sha256:1"]],
    ["docs", "recursive", ["sha256:2"]],
  ]);
  expect(a).toMatchObject({
    result: "passed",
    durationMs: 10,
    collectMs: 20,
    uncacheableReasons: [],
    toolchainDigest: "sha256:toolchain",
  });
  expect(ledger.summary).toMatchObject({ files: 2, cacheable: 2, records: 2, unboundRecords: 0 });
});

it("classifies every closed uncacheable reason from the recorded closure", () => {
  expect(CI_TEST_UNCACHEABLE_REASONS).toEqual([
    "unobserved_child",
    "git_in_repository",
    "network",
    "host_state",
    "untracked_input",
    "module_graph_unavailable",
    "unobserved_input",
    "shard_written_input",
  ]);
  const child = (command, overrides = {}) => ({
    command,
    args: [command],
    cwd: "<temporary>",
    pid: null,
    inherited: true,
    synchronous: true,
    failed: false,
    ...overrides,
  });
  const records = [
    worker("unobserved.test.ts", { pid: 1, children: [child("bash")] }),
    worker("git-file.test.ts", { pid: 3, inputs: [".git:HEAD"] }),
    worker("network.test.ts", {
      pid: 4,
      external: ["api.github.com:443"],
      counts: { external: 1 },
    }),
    worker("host.test.ts", { pid: 5, host: ["~/.gitconfig"], counts: { host: 1 } }),
    worker("untracked.test.ts", { pid: 6, inputs: ["local-notes.md"] }),
    worker("partial.test.ts", { pid: 7, end: null }),
    worker("file-complete.test.ts", { pid: 12, end: "file" }),
    worker("truncated.test.ts", { pid: 8, truncated: true }),
    worker("legacy-esm.test.ts", { pid: 9, notes: ["require_esm_unobserved"] }),
    worker("clean.test.ts", {
      pid: 10,
      children: [child("git"), child("missing", { failed: true })],
      counts: { loopback: 3, clockNow: 2 },
    }),
    // A process bound to a file but without any worker record leaves its graph unknown.
    { ...worker("no-worker.test.ts", { pid: 11 }), role: "process" },
    worker("buffer-path.test.ts", { pid: 13, notes: ["unobserved_path"] }),
  ];
  expect(reasonsOf(records)).toEqual({
    "unobserved.test.ts": ["unobserved_child"],
    "git-file.test.ts": ["git_in_repository"],
    "network.test.ts": ["network"],
    "host.test.ts": ["host_state"],
    "untracked.test.ts": ["untracked_input"],
    "partial.test.ts": ["module_graph_unavailable"],
    "file-complete.test.ts": [],
    "truncated.test.ts": ["module_graph_unavailable"],
    "legacy-esm.test.ts": ["module_graph_unavailable"],
    "clean.test.ts": [],
    "no-worker.test.ts": ["module_graph_unavailable"],
    "buffer-path.test.ts": ["unobserved_input"],
  });
  // Git inside the repository can change the tree, so it also taints the rest of its shard,
  // unless its subcommand only reads or writes inside `.git`.
  const git = (args) =>
    reasonsOf([
      worker("git.test.ts", { pid: 2, children: [child("git", { cwd: ".", args })] }),
      worker("bystander.test.ts", { pid: 3 }),
    ]);
  expect(git(["git", "checkout", "-q", "main"])).toEqual({
    "git.test.ts": ["git_in_repository"],
    "bystander.test.ts": ["shard_written_input"],
  });
  expect(git(["git", "-C", ".", "rev-parse", "HEAD"])["bystander.test.ts"]).toEqual([]);
  // A clone between temporary paths writes only there; one into the repository does not.
  expect(
    git(["git", "clone", "--quiet", "<temporary>", "<temporary>"])["bystander.test.ts"],
  ).toEqual([]);
  expect(
    git(["git", "init", "--quiet", "--bare", "-b", "main", "<temporary>"])["bystander.test.ts"],
  ).toEqual([]);
  expect(git(["git", "clone", "<temporary>", "fixtures/copy"])["bystander.test.ts"]).toEqual([
    "shard_written_input",
  ]);
  expect(git(["git", "a", "b", "c", "d", "e", "f", "rev-parse"])["bystander.test.ts"]).toEqual([
    "shard_written_input",
  ]);
});

// r3 of the 2026-11-15 review: an index of the reconstructed tree cannot see what another file of
// the shard wrote before a file read it, so such a closure is never complete.
it("r3: marks a closure that touches a path another process of the shard wrote", () => {
  const tracked = ["shared", "dir/a", "dir/b", "own", "other"];
  const reasons = reasonsOf(
    [
      worker("writer.test.ts", { pid: 1, writes: ["shared", "dir/new", "own"] }),
      worker("reader.test.ts", { pid: 2, inputs: ["shared"] }),
      worker("lister.test.ts", { pid: 3, listings: { dir: { plain: "sha256:1" } } }),
      worker("prober.test.ts", { pid: 4, absent: ["dir/new"] }),
      worker("parent.test.ts", { pid: 5, inputs: ["dir/a"], writes: [] }),
      worker("own.test.ts", { pid: 6, inputs: ["other"], writes: ["other"] }),
      worker("writer-reads.test.ts", { pid: 7, inputs: ["own"] }),
      worker(null, { pid: 8, role: "process", writes: ["dir"] }),
    ],
    { tracked: [...tracked, "writer.test.ts", "reader.test.ts"] },
  );
  expect(reasons["reader.test.ts"]).toEqual(["shard_written_input"]);
  expect(reasons["lister.test.ts"]).toContain("shard_written_input");
  expect(reasons["prober.test.ts"]).toEqual(["shard_written_input"]);
  // An unbound process removed `dir`, so every file below it is uncertain too.
  expect(reasons["parent.test.ts"]).toEqual(["shard_written_input"]);
  // A file's own writes follow from its own inputs.
  expect(reasons["own.test.ts"]).not.toContain("shard_written_input");
  expect(reasons["writer-reads.test.ts"]).toContain("shard_written_input");
});

it("marks every other file when a process wrote through a path the recorder could not read", () => {
  const reasons = reasonsOf([
    worker("blind.test.ts", { pid: 1, notes: ["unobserved_write"] }),
    worker("bystander.test.ts", { pid: 2 }),
  ]);
  expect(reasons["blind.test.ts"]).toEqual(["unobserved_input"]);
  expect(reasons["bystander.test.ts"]).toEqual(["shard_written_input"]);
});

it("treats an unrecorded child working in the repository as a process that could write anything", () => {
  const child = (overrides) => ({
    command: "bash",
    args: ["bash"],
    cwd: "packages/core",
    pid: null,
    inherited: false,
    synchronous: true,
    failed: false,
    ...overrides,
  });
  const inRepository = reasonsOf([
    worker("shell.test.ts", { pid: 1, children: [child()] }),
    worker("bystander.test.ts", { pid: 2 }),
  ]);
  expect(inRepository["bystander.test.ts"]).toEqual(["shard_written_input"]);
  const elsewhere = reasonsOf([
    worker("shell.test.ts", { pid: 1, children: [child({ cwd: "<temporary>" })] }),
    worker("bystander.test.ts", { pid: 2 }),
  ]);
  expect(elsewhere["bystander.test.ts"]).toEqual([]);
});

it("treats a record that dropped writes as a process that could have written anything", () => {
  const reasons = reasonsOf([
    worker("bounded.test.ts", { pid: 1, truncated: true, writesDropped: true }),
    worker("bystander.test.ts", { pid: 2 }),
  ]);
  expect(reasons["bounded.test.ts"]).toEqual(["module_graph_unavailable"]);
  expect(reasons["bystander.test.ts"]).toEqual(["shard_written_input"]);
});

it("follows observed children by PID or argument tail and absorbs their inputs", () => {
  const ledger = ledgerOf(
    [
      worker("cli.test.ts", {
        pid: 20,
        inputs: ["cli.test.ts"],
        children: [
          {
            command: "node",
            args: ["<toolchain>", "--import", "x", "bin.js", "run"],
            cwd: "<temporary>",
            pid: null,
            inherited: true,
            synchronous: true,
            failed: false,
          },
          {
            command: "node",
            args: ["<toolchain>", "bin.js", "serve"],
            cwd: "<temporary>",
            pid: 31,
            inherited: true,
            synchronous: false,
            failed: false,
          },
        ],
      }),
      {
        ...worker(null, { pid: 30, ppid: 20, inputs: ["bin.js"] }),
        role: "process",
        invocation: ["bin.js", "run"],
      },
      {
        ...worker("cli.test.ts", { pid: 31, ppid: 20, inputs: ["serve.json"] }),
        role: "process",
        invocation: ["bin.js", "serve"],
      },
      // Same PID under another parent is a different process.
      { ...worker("cli.test.ts", { pid: 31, ppid: 99, inputs: ["stray.json"] }), role: "process" },
    ],
    { tracked: ["cli.test.ts", "bin.js", "serve.json", "stray.json"] },
  );
  const [file] = ledger.files;
  expect(file.children).toMatchObject({ spawned: 2, observed: 2, unobserved: {} });
  // The stray record is bound to the file, so its reads still count as the file's inputs.
  expect(file.inputs.map((index) => ledger.paths[index])).toEqual([
    "bin.js",
    "cli.test.ts",
    "serve.json",
    "stray.json",
  ]);
  expect(file.uncacheableReasons).toEqual([]);
});

it("maps built outputs to sources as notes and reports unmapped ones as untracked", () => {
  const generated = new Map([
    ...readBundleMetafile({
      outputs: {
        "apps/cli/dist/bin.js": {
          inputs: {
            "apps/cli/src/bin.ts": {},
            "packages/core/dist/index.js": {},
            "lervo-node-sqlite:node:sqlite": {},
          },
        },
      },
    }),
    ...readSchemaValidatorManifest(
      {
        inputs: [
          ["packages/schemas/src/event.ts", "sha256:1"],
          ["pnpm-lock.yaml", "sha256:2"],
        ],
      },
      "packages/schemas/dist/generated",
      ["validators.js", "manifest.json"],
    ),
  ]);
  const ledger = ledgerOf(
    [
      worker("built.test.ts", {
        inputs: [
          "apps/cli/dist/bin.js",
          "packages/cas/dist/native/cas.node",
          "packages/docs/dist/render.d.ts",
          "apps/cli/node_modules/@lervo/core/dist/index.js",
          "packages/core/dist",
          "packages/schemas/dist/generated/validators.js",
          "packages/generated/dist/validators.js",
        ],
      }),
    ],
    {
      tracked: [
        "built.test.ts",
        "apps/cli/src/bin.ts",
        "packages/core/src/index.ts",
        "packages/docs/src/render.ts",
      ],
      generated,
      workspaces: new Map([["@lervo/core", "packages/core"]]),
    },
  );
  const name = (index) => ledger.paths[index];
  const notes = Object.fromEntries(
    ledger.buildOutputs.map(({ output, via, sources }) => [
      name(output),
      [via, ...sources.map(name)],
    ]),
  );
  expect(notes).toEqual({
    "apps/cli/dist/bin.js": [
      "bundle_metafile",
      "apps/cli/src/bin.ts",
      "packages/core/dist/index.js",
    ],
    "apps/cli/node_modules/@lervo/core/dist/index.js": [
      "workspace_link",
      "packages/core/dist/index.js",
    ],
    "packages/cas/dist/native/cas.node": ["native_artifact"],
    "packages/core/dist": ["source", "packages/core/src"],
    "packages/core/dist/index.js": ["source", "packages/core/src/index.ts"],
    "packages/docs/dist/render.d.ts": ["source", "packages/docs/src/render.ts"],
    "packages/schemas/dist/generated/validators.js": [
      "schema_validator_manifest",
      "packages/schemas/src/event.ts",
      "pnpm-lock.yaml",
    ],
  });
  expect(ledger.unmappedBuildOutputs.map(name)).toEqual(["packages/generated/dist/validators.js"]);
  const [file] = ledger.files;
  expect(file.uncacheableReasons).toEqual(["untracked_input"]);
  expect(file.untracked.map(name)).toEqual(["packages/generated/dist/validators.js"]);
});

it("keeps a full shard's ledger within a few megabytes", () => {
  const pool = Array.from({ length: 6000 }, (_, i) => `packages/p${i % 120}/src/module-${i}.ts`);
  const records = Array.from({ length: 320 }, (_, file) =>
    worker(`packages/p${file % 120}/test/file-${file}.test.ts`, {
      pid: 1000 + file,
      inputs: Array.from({ length: 400 }, (_, i) => pool[(file * 37 + i * 11) % pool.length]),
      dependencies: Array.from({ length: 40 }, (_, i) => `pnpm:dependency-${i}@1.0.0`),
      listings: { [`packages/p${file % 120}`]: { plain: "sha256:".padEnd(71, "0") } },
    }),
  );
  const ledger = ledgerOf(records, { tracked: pool });
  const bytes = Buffer.byteLength(JSON.stringify(ledger));
  expect(ledger.files).toHaveLength(320);
  expect(ledger.paths.length).toBeLessThanOrEqual(pool.length + 40 + 120);
  expect(bytes).toBeLessThan(4 * 1024 * 1024);
});

it("reads weights only for files a ledger executed", () => {
  const ledger = ledgerOf([worker("a.test.ts"), worker("b.test.ts", { pid: 2 })]);
  ledger.files[1].result = "skipped";
  expect(Object.fromEntries(readCiTestLedgerWeights(ledger))).toEqual({ "a.test.ts": 30 });
  expect(() => readCiTestLedgerWeights({ contract: "other", files: [] })).toThrow(
    "ci_test_ledger_invalid",
  );
});

it("counts collapsed children by their recorded count", () => {
  const git = (cwd, count) => ({
    command: "git",
    args: ["git", "status"],
    cwd,
    pid: null,
    inherited: true,
    synchronous: true,
    failed: false,
    count,
  });
  const ledger = ledgerOf([
    worker("busy.test.ts", {
      children: [
        git("<temporary>", 1500),
        git(".", 2),
        { ...git("<temporary>", 4), command: "ps", inherited: false },
        { ...git("<temporary>", 3), bootstrap: true },
      ],
    }),
  ]);
  expect(ledger.files[0].children).toEqual({
    bootstrap: 3,
    spawned: 1506,
    observed: 0,
    failed: 0,
    gitOutsideRepository: 1500,
    gitInRepository: 2,
    unobserved: { "ps (no recorder)": 4 },
  });
  expect(ledger.files[0].uncacheableReasons).toEqual(["unobserved_child", "git_in_repository"]);
});

it("treats a matched child without an end marker as unobserved", () => {
  const child = {
    command: "node",
    args: ["<toolchain>", "server.js"],
    cwd: "<temporary>",
    pid: 41,
    inherited: true,
    synchronous: false,
    failed: false,
  };
  const ledger = ledgerOf(
    [
      worker("killed.test.ts", { pid: 40, children: [child] }),
      {
        ...worker("killed.test.ts", { pid: 41, ppid: 40, inputs: ["server.js"], end: null }),
        role: "process",
      },
      // A process ending with its file's hook is complete only when it is the worker.
      {
        ...worker("killed.test.ts", { pid: 42, ppid: 40, end: "file" }),
        role: "process",
      },
    ],
    { tracked: ["server.js"] },
  );
  const [file] = ledger.files;
  expect(file.children).toMatchObject({
    observed: 0,
    unobserved: { "node (incomplete record)": 1 },
  });
  expect(file.inputs.map((index) => ledger.paths[index])).toEqual(["server.js"]);
  expect(file.processes).toEqual({ records: 3, complete: 1 });
  expect(file.uncacheableReasons).toEqual(["unobserved_child"]);
});
