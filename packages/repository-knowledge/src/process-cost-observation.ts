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

interface CostTally {
  scope(scope: string): ProcessCostScope;
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
const SUBCOMMAND = /^[a-z][a-z0-9-]{0,39}$/u;
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--exec-path",
]);

const contexts = new AsyncLocalStorage<CostContext>();
const processObservers = new Set<CostTally>();
let activeMeasurements = 0;
let subscribed = false;

function createTally(): CostTally {
  let gitProcesses = 0;
  const scopes = new Map<string, ProcessCostScope>();
  const scope = (name: string) => {
    const key = scopes.has(name) || scopes.size < MAXIMUM_SCOPES ? name : OVERFLOW;
    let entry = scopes.get(key);
    if (entry === undefined) {
      entry = { calls: 0, wallMilliseconds: 0, cpuMicroseconds: 0, gitProcesses: {} };
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
        subcommand in counts || Object.keys(counts).length < MAXIMUM_SUBCOMMANDS
          ? subcommand
          : OVERFLOW;
      counts[key] = (counts[key] ?? 0) + 1;
    },
    snapshot: () => ({
      gitProcesses,
      scopes: Object.fromEntries(
        [...scopes].map(([name, entry]) => [
          name,
          {
            ...entry,
            wallMilliseconds: Math.round(entry.wallMilliseconds),
            gitProcesses: { ...entry.gitProcesses },
          },
        ]),
      ),
    }),
  };
}

function observing(): boolean {
  return processObservers.size > 0 || activeMeasurements > 0;
}

/** The Git subcommand after global options, or `other` when it is not a plain command name. */
function gitSubcommand(args: readonly string[]): string {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return SUBCOMMAND.test(arg) ? arg : OVERFLOW;
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
  const result = contexts.run({ scope, tallies }, run);
  if (result instanceof Promise) return result.finally(settle) as T;
  settle();
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
