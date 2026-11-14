import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";

/** One scope's inclusive cost: nested scopes are also counted in their parents. */
export interface ProcessCostScope {
  calls: number;
  wallMilliseconds: number;
  /** Process-wide user plus system CPU while the scope ran, including concurrent work. */
  cpuMicroseconds: number;
  /** Git processes started inside the scope, by Git subcommand. */
  gitProcesses: Record<string, number>;
}

/** Counts and code-defined scope names only; no path, argument, or output is retained. */
export interface ProcessCostSnapshot {
  gitProcesses: number;
  scopes: Record<string, ProcessCostScope>;
}

/** A measured run's cost: its own Git processes, plus wall and process-wide CPU time. */
export interface ProcessCostMeasurement extends ProcessCostSnapshot {
  wallMilliseconds: number;
  cpuMicroseconds: number;
}

interface ScopeTally {
  calls: number;
  wallMilliseconds: number;
  cpuMicroseconds: number;
  gitProcesses: Map<string, number>;
}

interface CostTally {
  scope(scope: string): ScopeTally;
  gitProcess(scope: string, subcommand: string): void;
  snapshot(): ProcessCostSnapshot;
}

interface CostContext {
  /** Empty at a measurement's root. */
  scope: string;
  tallies: readonly CostTally[];
}

const UNSCOPED = "unscoped";
const OVERFLOW = "other";
const MAXIMUM_SCOPES = 256;
const MAXIMUM_SUBCOMMANDS = 48;
const MAXIMUM_SCOPE_DEPTH = 4;
const SCOPE_NAME = /^[a-z][a-z0-9_.-]{0,47}$/u;
/** Git's global options that consume the next argument as their value. */
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--config-env",
  "--shallow-file",
  "--attr-source",
]);
/**
 * Git commands Lervo runs. Any other name, such as an alias or a value read where a command was
 * expected, counts as `other`, so no argument value can reach a report.
 */
const GIT_SUBCOMMANDS = new Set([
  "add",
  "apply",
  "archive",
  "branch",
  "bundle",
  "cat-file",
  "check-attr",
  "check-ignore",
  "checkout",
  "checkout-index",
  "cherry",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "commit-tree",
  "config",
  "describe",
  "diff",
  "diff-index",
  "diff-tree",
  "fetch",
  "for-each-ref",
  "grep",
  "hash-object",
  "init",
  "log",
  "ls-files",
  "ls-remote",
  "ls-tree",
  "merge",
  "merge-base",
  "merge-tree",
  "mv",
  "notes",
  "patch-id",
  "prune",
  "pull",
  "push",
  "read-tree",
  "remote",
  "replace",
  "reset",
  "restore",
  "rev-list",
  "rev-parse",
  "revert",
  "rm",
  "shortlog",
  "show",
  "show-ref",
  "stash",
  "status",
  "switch",
  "symbolic-ref",
  "tag",
  "update-index",
  "update-ref",
  "var",
  "version",
  "worktree",
  "write-tree",
]);

const contexts = new AsyncLocalStorage<CostContext>();
const processObservers = new Set<CostTally>();
let activeMeasurements = 0;
let subscribed = false;

/** A report object without a prototype, so no key can shadow or reach `Object.prototype`. */
function record<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  const value = Object.create(null) as Record<string, T>;
  for (const [key, item] of entries) value[key] = item;
  return value;
}

function createTally(): CostTally {
  let gitProcesses = 0;
  const scopes = new Map<string, ScopeTally>();
  const scope = (name: string) => {
    const key = scopes.has(name) || scopes.size < MAXIMUM_SCOPES ? name : OVERFLOW;
    let entry = scopes.get(key);
    if (entry === undefined) {
      entry = { calls: 0, wallMilliseconds: 0, cpuMicroseconds: 0, gitProcesses: new Map() };
      scopes.set(key, entry);
    }
    return entry;
  };
  return {
    scope,
    gitProcess(name, subcommand) {
      gitProcesses += 1;
      const counts = scope(name).gitProcesses;
      const key =
        counts.has(subcommand) || counts.size < MAXIMUM_SUBCOMMANDS ? subcommand : OVERFLOW;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
    snapshot: () => ({
      gitProcesses,
      scopes: record(
        [...scopes].map(([name, entry]) => [
          name,
          {
            calls: entry.calls,
            wallMilliseconds: Math.round(entry.wallMilliseconds),
            cpuMicroseconds: entry.cpuMicroseconds,
            gitProcesses: record(entry.gitProcesses),
          },
        ]),
      ),
    }),
  };
}

function observing(): boolean {
  return processObservers.size > 0 || activeMeasurements > 0;
}

/** The Git command after global options when it is one Lervo runs; otherwise `other`. */
function gitSubcommand(args: readonly string[]): string {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return GIT_SUBCOMMANDS.has(arg) ? arg : OVERFLOW;
  }
  return OVERFLOW;
}

function recordGit(args: readonly string[]): void {
  const context = contexts.getStore();
  const subcommand = gitSubcommand(args);
  const scope = context?.scope || UNSCOPED;
  for (const tally of context?.tallies ?? []) tally.gitProcess(scope, subcommand);
  for (const tally of processObservers) tally.gitProcess(scope, subcommand);
}

function isGit(file: string | undefined): boolean {
  return file !== undefined && /^git(?:\.exe)?$/iu.test(basename(file));
}

// Every asynchronous spawn publishes its ChildProcess before `spawn` assigns its arguments; the
// arguments are readable once the synchronous spawn call returns.
function onChildProcess(message: unknown): void {
  const child = (message as { process?: ChildProcess }).process;
  if (child === undefined) return;
  // A microtask runs in the async context that queued it.
  queueMicrotask(() => {
    if (isGit(child.spawnfile)) recordGit(child.spawnargs.slice(1));
  });
}

function updateSubscription(): void {
  if (observing() && !subscribed) {
    subscribe("child_process", onChildProcess);
    subscribed = true;
  } else if (!observing() && subscribed) {
    unsubscribe("child_process", onChildProcess);
    subscribed = false;
  }
}

/**
 * Synchronous spawns publish no child-process diagnostics, so each synchronous Git call site
 * records its arguments here before it runs.
 */
export function recordSynchronousGitProcess(args: readonly string[]): void {
  if (observing()) recordGit(args);
}

/**
 * Runs `run` under a named scope nested in the current one. When nothing observes process cost
 * this is a plain call, so production paths pay nothing for their labels.
 */
export function withProcessCostScope<T>(name: string, run: () => T): T {
  if (!observing()) return run();
  const label = SCOPE_NAME.test(name) ? name : OVERFLOW;
  const parent = contexts.getStore();
  const parentScope = parent?.scope ?? "";
  const scope =
    parentScope === ""
      ? label
      : parentScope.split("/").length >= MAXIMUM_SCOPE_DEPTH
        ? parentScope
        : `${parentScope}/${label}`;
  const tallies = parent?.tallies ?? [];
  const startedAt = performance.now();
  const cpuBefore = process.cpuUsage();
  const settle = () => {
    const cpu = process.cpuUsage(cpuBefore);
    const wall = performance.now() - startedAt;
    for (const tally of [...tallies, ...processObservers]) {
      const entry = tally.scope(scope);
      entry.calls += 1;
      entry.wallMilliseconds += wall;
      entry.cpuMicroseconds += cpu.user + cpu.system;
    }
  };
  let result: T;
  try {
    result = contexts.run({ scope, tallies }, run);
  } catch (error) {
    settle();
    throw error;
  }
  // The caller receives the very promise `run` returned, with any properties it carries; the
  // settlement branch handles a rejection itself, so it can never be reported as unhandled.
  if (result instanceof Promise) result.then(settle, settle);
  else settle();
  return result;
}

/** Process-wide observation for tests and measurement harnesses; `close` stops counting. */
export function observeProcessCost(): { snapshot(): ProcessCostSnapshot; close(): void } {
  const tally = createTally();
  processObservers.add(tally);
  updateSubscription();
  return {
    snapshot: () => tally.snapshot(),
    close() {
      processObservers.delete(tally);
      updateSubscription();
    },
  };
}

/**
 * The cost of `run` alone: Git processes are attributed through its async context, so concurrent
 * work elsewhere in the process is not counted, while CPU is the whole process's.
 */
export async function measureProcessCost<T>(
  run: () => Promise<T>,
): Promise<{ value: T; cost: ProcessCostMeasurement }> {
  const tally = createTally();
  const parent = contexts.getStore();
  activeMeasurements += 1;
  updateSubscription();
  const startedAt = performance.now();
  const cpuBefore = process.cpuUsage();
  try {
    const value = await contexts.run(
      { scope: parent?.scope ?? "", tallies: [...(parent?.tallies ?? []), tally] },
      run,
    );
    const cpu = process.cpuUsage(cpuBefore);
    return {
      value,
      cost: {
        ...tally.snapshot(),
        wallMilliseconds: Math.round(performance.now() - startedAt),
        cpuMicroseconds: cpu.user + cpu.system,
      },
    };
  } finally {
    activeMeasurements -= 1;
    updateSubscription();
  }
}
