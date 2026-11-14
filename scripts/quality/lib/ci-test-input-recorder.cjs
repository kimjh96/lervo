"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const net = require("node:net");
const { homedir, tmpdir } = require("node:os");
const { basename, dirname, resolve } = require("node:path");
const { isMainThread, threadId } = require("node:worker_threads");

const { installChildProcessObserver } = require("./ci-test-input-child-observer.cjs");
const { installClockObserver } = require("./ci-test-input-clock-observer.cjs");
const { installFilesystemObserver } = require("./ci-test-input-filesystem-observer.cjs");
const { installModuleObserver } = require("./ci-test-input-module-observer.cjs");
const { installNetworkObserver } = require("./ci-test-input-network-observer.cjs");
const { absoluteInputPath, createCiTestPathClassifier } = require("./ci-test-input-paths.cjs");
const { CiTestInputRecord, ciTestInvocation } = require("./ci-test-input-record.cjs");

/**
 * Observe-only test input recorder (ADR-0565), preloaded into every Node process of a CI test
 * shard through `NODE_OPTIONS=--require`. It records what each process reads and starts, then
 * spools one bounded record per process for the ledger reporter. It never changes which tests run
 * or what they observe: every wrapper returns the original result, and a recorder failure only
 * loses the record. `LERVO_CI_TEST_LEDGER=off` or a missing ledger directory leaves it inert.
 */
const RECORDER_KEY = Symbol.for("lervo.ciTestInputRecorder");
const directory = process.env.LERVO_CI_TEST_LEDGER_DIRECTORY;
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const mkdirSync = fs.mkdirSync;
const realpathSync = fs.realpathSync;
const statSync = fs.statSync;
const readdirSync = fs.readdirSync;

const realpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

function toolchainRoots() {
  const roots = [dirname(dirname(process.execPath)), "/opt/hostedtoolcache"];
  roots.push(dirname(dirname(realpath(process.execPath))));
  if (process.env.PNPM_HOME) roots.push(process.env.PNPM_HOME);
  const executable = process.env.npm_execpath ?? "";
  const pnpm = executable.lastIndexOf("/node_modules/pnpm/");
  if (pnpm > 0) roots.push(executable.slice(0, pnpm));
  return roots;
}

function start() {
  const libraryDirectory = __dirname;
  const repositoryRoot = resolve(libraryDirectory, "../../..");
  const temporaryRoot = tmpdir();
  const classify = createCiTestPathClassifier({
    repositoryRoots: [repositoryRoot, realpath(repositoryRoot)],
    temporaryRoots: [
      temporaryRoot,
      realpath(temporaryRoot),
      process.env.RUNNER_TEMP,
      "/tmp",
      "/var/tmp",
      "/dev/shm",
      "/private/tmp",
      "/private/var/folders",
      "/var/folders",
    ],
    toolchainRoots: toolchainRoots(),
    homeDirectory: homedir(),
  });
  /** Absolute arguments become their classified form, so records carry no host-specific paths. */
  const displayArgument = (argument) => {
    const text = String(argument);
    if (!text.startsWith("/")) return text;
    const { kind, path } = classify(text);
    return path === null ? `<${kind}>` : kind === "dependency" ? `<${path}>` : path;
  };
  const role = process.argv[1]?.endsWith("/tinypool/dist/entry/process.js") ? "worker" : "process";
  const record = new CiTestInputRecord({
    pid: process.pid,
    ppid: process.ppid,
    threadId,
    role,
    // Flags such as `-e <code>` live in execArgv; NODE_OPTIONS flags never appear in either.
    invocation: ciTestInvocation(
      [...process.execArgv, ...process.argv.slice(1)].map(displayArgument),
    ),
  });
  record.file = process.env.LERVO_CI_TEST_FILE ?? null;
  const cwd = () => process.cwd();

  installFilesystemObserver({
    fs,
    observe(operation, argument, recursive) {
      const path = absoluteInputPath(argument, cwd());
      if (path !== null) record.path(classify(path), operation, path, recursive);
    },
  });
  installChildProcessObserver({
    childProcess,
    observe({ file, args, cwd: requested, environment, pid, synchronous, failed }) {
      // `null` is a working directory the observer could not read without running user code.
      const location = requested === null ? null : absoluteInputPath(requested ?? cwd(), cwd());
      const gitTarget = gitDirectoryArgument(args);
      const target = gitTarget ? absoluteInputPath(gitTarget, location ?? cwd()) : location;
      const where = target ? classify(target) : { kind: "unknown", path: null };
      record.child({
        command: basename(file),
        args: [file, ...args].map(displayArgument),
        cwd: where.kind === "repository" ? where.path : `<${where.kind}>`,
        pid,
        // An environment the observer could not read may still carry the recorder.
        inherited:
          environment === null ||
          (environment.LERVO_CI_TEST_LEDGER !== "off" &&
            typeof environment.LERVO_CI_TEST_LEDGER_DIRECTORY === "string" &&
            (environment.NODE_OPTIONS ?? "").includes("ci-test-input-recorder.cjs")),
        synchronous,
        failed,
        // Before Vitest assigns a file, a worker runs only Vitest's own startup, such as tinypool
        // counting CPUs through `sh`; that belongs to the toolchain, not to any test file.
        bootstrap: role === "worker" && globalThis.__vitest_worker__?.filepath === undefined,
      });
    },
  });
  installNetworkObserver({
    net,
    observe: ({ kind, endpoint }) => record.connection(kind, endpoint),
  });
  const modules = installModuleObserver({
    Module,
    legacyRequireEsm: typeof Module.registerHooks !== "function",
    observe(event) {
      if (event.kind === "native") {
        const path = absoluteInputPath(event.filename, cwd());
        if (path !== null) record.path(classify(path), "read", path);
      } else record.note("require_esm_unobserved");
    },
  });
  const ownFiles = new Set(
    [
      "ci-test-input-recorder.cjs",
      "ci-test-input-clock-observer.cjs",
      "ci-test-input-record.cjs",
    ].map((name) => resolve(libraryDirectory, name)),
  );
  installClockObserver({ observe: (kind) => record.clock(kind), ownFiles });
  // ESM named imports of builtins such as `import { readFileSync } from "node:fs"` see the wrappers.
  Module.syncBuiltinESMExports();

  const spoolDirectory = resolve(directory, "spool");
  const spoolFile = resolve(
    spoolDirectory,
    `${process.pid}-${threadId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.json`,
  );
  /** Records the vite-node module graph, which the worker fetches over RPC instead of reading. */
  const recordWorkerModules = () => {
    if (record.identity.role !== "worker" || record.file === null) return;
    const cache = globalThis.__vitest_worker__?.moduleCache;
    if (!(cache instanceof Map)) return record.note("module_graph_unavailable");
    for (const id of cache.keys()) {
      const path = String(id)
        .replace(/^mock:/u, "")
        .replace(/^\/@fs\//u, "/")
        .replace(/[?#].*$/u, "");
      // Virtual modules such as `/@vite/env` have no file.
      if (path.startsWith("/") && !path.startsWith("/@")) record.module(classify(path));
    }
  };
  let flushing = false;
  const flush = (final) => {
    if (flushing) return;
    flushing = true;
    try {
      recordWorkerModules();
      modules.inspect();
      if (modules.sqliteLoaded()) record.note("sqlite_unobserved");
      record.resolve({ exists, list: listingDigest });
      mkdirSync(spoolDirectory, { recursive: true });
      const temporary = `${spoolFile}.partial`;
      writeFileSync(temporary, JSON.stringify({ ...record.toJSON(), final }));
      renameSync(temporary, spoolFile);
    } catch {
      // A lost record is reported by the ledger as an unobserved process.
    } finally {
      flushing = false;
    }
  };
  process.on("exit", () => flush(true));
  if (isMainThread) {
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
      const onSignal = () => {
        flush(true);
        // Alone, this listener would suppress the default exit; restore it and re-deliver.
        if (process.listenerCount(signal) === 1) {
          process.removeListener(signal, onSignal);
          process.kill(process.pid, signal);
        }
      };
      process.on(signal, onSignal);
    }
  }
  return {
    bind(file) {
      const path = absoluteInputPath(file, cwd());
      const classified = path === null ? null : classify(path);
      if (classified?.kind !== "repository") return;
      record.file = classified.path;
      process.env.LERVO_CI_TEST_FILE = classified.path;
    },
    flush: () => flush(false),
  };
}

function gitDirectoryArgument(args) {
  for (let index = 0; index < (args?.length ?? 0); index += 1) {
    const argument = String(args[index]);
    if (argument === "-C") return args[index + 1];
    if (argument.startsWith("--git-dir=") || argument.startsWith("--work-tree="))
      return argument.slice(argument.indexOf("=") + 1);
  }
  return null;
}

function exists(path) {
  try {
    return statSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    // A path that exists but cannot be inspected is still an input.
    return true;
  }
}

let hash;
/** Digest of the sorted entry names, read when the record is spooled. */
function listingDigest(path, recursive) {
  try {
    hash ??= process.getBuiltinModule("node:crypto").createHash;
    const names = readdirSync(path, { recursive }).map(String).sort();
    const prefix = recursive ? "recursive\n" : "";
    return `sha256:${hash("sha256")
      .update(`${prefix}${names.join("\n")}`)
      .digest("hex")}`;
  } catch {
    return "unlisted";
  }
}

if (
  globalThis[RECORDER_KEY] === undefined &&
  process.env.LERVO_CI_TEST_LEDGER !== "off" &&
  typeof directory === "string" &&
  directory.startsWith("/")
) {
  try {
    globalThis[RECORDER_KEY] = start();
  } catch {
    globalThis[RECORDER_KEY] = null;
  }
}
