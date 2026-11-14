"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const net = require("node:net");
const { homedir, tmpdir } = require("node:os");
const { basename, dirname, isAbsolute, resolve } = require("node:path");
const { threadId } = require("node:worker_threads");

const { installChildProcessObserver } = require("./ci-test-input-child-observer.cjs");
const { installClockObserver } = require("./ci-test-input-clock-observer.cjs");
const { installFilesystemObserver } = require("./ci-test-input-filesystem-observer.cjs");
const {
  apply,
  cwd: processCwd,
  defineProperty,
  getBuiltinModule,
  global,
  hrtime,
  NativeDate,
  ProxyConstructor,
  processObject,
  SafeMap,
  SafeSet,
  stringify,
  toText,
  wallClock,
} = require("./ci-test-input-intrinsics.cjs");
const { ciTestListingDigest } = require("./ci-test-input-listing.cjs");
const { installModuleObserver } = require("./ci-test-input-module-observer.cjs");
const { installNetworkObserver } = require("./ci-test-input-network-observer.cjs");
const { absoluteInputPath, createCiTestPathClassifier } = require("./ci-test-input-paths.cjs");
const { CiTestInputRecord, ciTestInvocation } = require("./ci-test-input-record.cjs");
const { ownData } = require("./ci-test-input-transparent-call.cjs");

/**
 * Observe-only test input recorder (ADR-0565), preloaded into every Node process of a CI test
 * shard through `NODE_OPTIONS=--require`. It records what each process reads and starts, and
 * spools one bounded record per process for the ledger reporter. It never changes which tests run
 * or what they observe: every wrapper returns the original result, and a recorder failure only
 * loses the record. `LERVO_CI_TEST_LEDGER=off` or a missing ledger directory leaves it inert.
 *
 * The recorder installs no listeners: any signal or `exit` listener changes Node's default
 * behavior or `process.listenerCount`. Instead the record is spooled again at most once a second
 * while observations arrive, so it survives a hard kill, and the `exit` event marks it complete
 * through a Proxy of `process.emit`. A record without that mark, or for a worker without the mark
 * its file's last hook writes, is incomplete, and the ledger never treats it as a full closure.
 */
const RECORDER_KEY = Symbol.for("lervo.ciTestInputRecorder");
const environment = process.env;
const directory = environment.LERVO_CI_TEST_LEDGER_DIRECTORY;
const startup = {
  // Wall-clock milliseconds, so the ledger can order processes of one shard.
  startedAt: Date.now(),
  pid: process.pid,
  ppid: process.ppid,
  execPath: process.execPath,
  argv: [...process.execArgv, ...process.argv.slice(1)],
  entry: process.argv[1],
  file: environment.LERVO_CI_TEST_FILE ?? null,
  pnpmHome: environment.PNPM_HOME,
  npmExecPath: environment.npm_execpath ?? "",
  runnerTemp: environment.RUNNER_TEMP,
  legacyRequireEsm: typeof Module.registerHooks !== "function",
  spoolName: `${process.pid}-${threadId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.json`,
};
const { writeFileSync, renameSync, mkdirSync, realpathSync, statSync, readdirSync } = fs;
const flushIntervalNanoseconds = 1_000_000_000n;

const realpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

function toolchainRoots() {
  const roots = [dirname(dirname(startup.execPath)), "/opt/hostedtoolcache"];
  roots.push(dirname(dirname(realpath(startup.execPath))));
  if (startup.pnpmHome) roots.push(startup.pnpmHome);
  const pnpm = startup.npmExecPath.lastIndexOf("/node_modules/pnpm/");
  if (pnpm > 0) roots.push(startup.npmExecPath.slice(0, pnpm));
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
      startup.runnerTemp,
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
    const text = toText(argument);
    if (!text.startsWith("/")) return text;
    const { kind, path } = classify(text);
    return path === null ? `<${kind}>` : kind === "dependency" ? `<${path}>` : path;
  };
  const role = startup.entry?.endsWith("/tinypool/dist/entry/process.js") ? "worker" : "process";
  const record = new CiTestInputRecord({
    pid: startup.pid,
    ppid: startup.ppid,
    threadId,
    role,
    // Flags such as `-e <code>` live in execArgv; NODE_OPTIONS flags never appear in either.
    invocation: ciTestInvocation(startup.argv.map(displayArgument)),
    startedAt: startup.startedAt,
  });
  record.file = startup.file;
  const now = () => apply(wallClock, NativeDate, []);
  const cwd = () => apply(processCwd, processObject, []);
  const vitestWorker = () => ownData(global, "__vitest_worker__");

  /** A path the recorder cannot place, or an observation that failed, leaves the closure open. */
  const writing = new SafeSet(["write", "write-prefix", "open"]);
  const observePath = (operation, argument, extra) => {
    try {
      if (operation === "unobserved")
        return record.note(writing.has(extra) ? "unobserved_write" : "unobserved_path");
      const path = absoluteInputPath(argument, cwd());
      if (path === null)
        return record.note(writing.has(operation) ? "unobserved_write" : "unobserved_path");
      if (operation === "write-prefix") {
        const parent = dirname(path);
        return record.path(classify(parent), "write", parent);
      }
      if (operation === "link-target") {
        // A relative symlink target resolves against the link's own directory.
        const link = extra === null ? null : absoluteInputPath(extra, cwd());
        if (!isAbsolute(argument) && link === null) return record.note("unobserved_path");
        const target = isAbsolute(argument) ? path : resolve(dirname(link), argument);
        return record.path(classify(target), "read", target);
      }
      record.path(classify(path), operation, path, extra);
    } catch {
      record.note(writing.has(operation) ? "unobserved_write" : "unobserved_path");
    }
  };
  installFilesystemObserver({
    fs,
    observe(operation, argument, extra) {
      observePath(operation, argument, extra);
      spoolWhenDue();
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
        startedAt: now(),
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
        bootstrap: role === "worker" && ownData(vitestWorker(), "filepath") === undefined,
      });
      spoolWhenDue();
    },
  });
  installNetworkObserver({
    net,
    observe({ kind, endpoint }) {
      record.connection(kind, endpoint);
      spoolWhenDue();
    },
  });
  const modules = installModuleObserver({
    Module,
    legacyRequireEsm: startup.legacyRequireEsm,
    observe(event) {
      if (event.kind === "native") {
        const path = absoluteInputPath(event.filename, cwd());
        if (path !== null) record.path(classify(path), "read", path);
      } else record.note("require_esm_unobserved");
    },
  });
  const ownFiles = new SafeSet(
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
  const spoolFile = resolve(spoolDirectory, startup.spoolName);
  /** Records the vite-node module graph, which the worker fetches over RPC instead of reading. */
  const recordWorkerModules = () => {
    if (record.identity.role !== "worker" || record.file === null) return;
    const cache = ownData(vitestWorker(), "moduleCache");
    if (!(cache instanceof SafeMap)) return record.note("module_graph_unavailable");
    for (const id of cache.keys()) {
      const path = toText(id)
        .replace(/^mock:/u, "")
        .replace(/^\/@fs\//u, "/")
        .replace(/[?#].*$/u, "");
      // Virtual modules such as `/@vite/env` have no file.
      if (path.startsWith("/") && !path.startsWith("/@")) record.module(classify(path));
    }
  };
  let flushing = false;
  let spooledAt = hrtime();
  let end = null;
  /** `end` is `exit` once the process exits, or `file` after a worker's last file hook. */
  const flush = (marker) => {
    if (flushing) return;
    flushing = true;
    try {
      if (marker !== null && end !== "exit") end = marker;
      recordWorkerModules();
      modules.inspect();
      if (modules.sqliteLoaded()) record.note("sqlite_unobserved");
      record.resolve({ exists, list: listingDigest });
      mkdirSync(spoolDirectory, { recursive: true });
      const temporary = `${spoolFile}.partial`;
      writeFileSync(temporary, stringify({ ...record.toJSON(), end, spooledAt: now() }));
      renameSync(temporary, spoolFile);
    } catch {
      // A lost record is reported by the ledger as an unobserved process.
    } finally {
      spooledAt = hrtime();
      flushing = false;
    }
  };
  function spoolWhenDue() {
    if (!flushing && hrtime() - spooledAt >= flushIntervalNanoseconds) flush(null);
  }
  // `process.emit` is inherited; an own Proxy of it adds no listener and runs after the original.
  const emit = processObject.emit;
  defineProperty(processObject, "emit", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: new ProxyConstructor(emit, {
      apply(target, self, args) {
        const result = apply(target, self, args);
        if (args[0] === "exit") flush("exit");
        return result;
      },
    }),
  });
  return {
    bind(file) {
      const path = absoluteInputPath(file, cwd());
      const classified = path === null ? null : classify(path);
      if (classified?.kind !== "repository") return;
      record.file = classified.path;
      environment.LERVO_CI_TEST_FILE = classified.path;
    },
    /** Spools after the file's last hook; the worker is often killed before it exits. */
    fileComplete: () => flush("file"),
  };
}

function gitDirectoryArgument(args) {
  for (let index = 0; index < (args?.length ?? 0); index += 1) {
    const argument = toText(args[index]);
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
/** Digest of the typed entries, read when the record is spooled; `unlisted` on failure. */
function listingDigest(path, recursive) {
  try {
    hash ??= apply(getBuiltinModule, processObject, ["node:crypto"]).createHash;
    return ciTestListingDigest({ readdirSync, createHash: hash }, path, recursive) ?? "unlisted";
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
