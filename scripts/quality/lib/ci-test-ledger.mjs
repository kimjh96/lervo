import { mapCiTestBuildOutputs } from "./ci-test-build-output-map.mjs";
import { createCiTestShardWrites } from "./ci-test-ledger-writes.mjs";

/**
 * Builds one shard's test input ledger (ADR-0565) from Vitest's per-file results and the process
 * records the recorder spooled. The ledger is observation only: nothing reads it to select,
 * skip or judge tests. Each file lists what its worker and every observed descendant read, with
 * repository paths stored once in a shared path table, and the closed reasons why its recorded
 * closure could not yet key a reuse.
 */
export const CI_TEST_LEDGER_CONTRACT = "lervo-ci-test-ledger-v2";
export const CI_TEST_UNCACHEABLE_REASONS = Object.freeze([
  "unobserved_child",
  "git_in_repository",
  "network",
  "host_state",
  "untracked_input",
  "module_graph_unavailable",
  "unobserved_input",
  "shard_written_input",
]);

const maximumSamples = 32;
const incompleteNotes = new Set(["module_graph_unavailable", "require_esm_unobserved"]);
const unobservedNotes = new Set(["unobserved_path", "unobserved_write"]);

/**
 * A process record is complete once it spooled at `exit`. A Vitest worker's record is complete
 * once it spooled after its file's last hook, because the pool kills workers after that.
 */
const isComplete = (record) =>
  record.end === "exit" || (record.role === "worker" && record.end === "file");

const tailMatches = (parent, child) =>
  child.length > 0 &&
  child.length <= parent.length &&
  child.every((argument, index) => parent[parent.length - child.length + index] === argument);

function indexRecords(records) {
  const byPid = new Map();
  const byParent = new Map();
  for (const record of records) {
    if (!byPid.has(record.pid)) byPid.set(record.pid, []);
    byPid.get(record.pid).push(record);
    if (!byParent.has(record.ppid)) byParent.set(record.ppid, []);
    byParent.get(record.ppid).push(record);
  }
  return { byPid, byParent };
}

/** Finds the records of one spawned child: by PID, or by its argument tail when only sync APIs ran. */
function childRecords(index, parent, child, file) {
  const candidates =
    child.pid === null
      ? (index.byParent.get(parent.pid) ?? []).filter((record) =>
          tailMatches(child.args, record.invocation ?? []),
        )
      : (index.byPid.get(child.pid) ?? []).filter((record) => record.ppid === parent.pid);
  return candidates.filter((record) => record.file === null || record.file === file);
}

function createAccumulator() {
  return {
    inputs: new Set(),
    absent: new Set(),
    trees: new Set(),
    listings: new Map(),
    dependencies: new Set(),
    host: new Set(),
    external: new Set(),
    notes: new Set(),
    unobserved: new Map(),
    counts: {
      bootstrap: 0,
      spawned: 0,
      observed: 0,
      failed: 0,
      gitOutsideRepository: 0,
      gitInRepository: 0,
      host: 0,
      loopback: 0,
      localSocket: 0,
      external: 0,
      clockNow: 0,
      clockConstruct: 0,
      clockUnattributed: 0,
    },
    records: 0,
    completeRecords: 0,
    endedAt: -Infinity,
    completeWorker: false,
    truncated: false,
  };
}

function absorb(accumulator, record) {
  accumulator.records += 1;
  accumulator.endedAt = Math.max(accumulator.endedAt, record.spooledAt ?? Infinity);
  if (isComplete(record)) accumulator.completeRecords += 1;
  if (record.role === "worker" && isComplete(record)) accumulator.completeWorker = true;
  if (record.truncated) accumulator.truncated = true;
  for (const path of [...(record.inputs ?? []), ...(record.modules ?? [])])
    accumulator.inputs.add(path);
  for (const path of record.absent ?? []) accumulator.absent.add(path);
  for (const path of record.trees ?? []) accumulator.trees.add(path);
  for (const [path, kinds] of Object.entries(record.listings ?? {}))
    for (const [kind, digest] of Object.entries(kinds)) {
      const key = `${kind}\0${path}`;
      const known = accumulator.listings.get(key) ?? new Set();
      known.add(digest);
      accumulator.listings.set(key, known);
    }
  for (const key of record.dependencies ?? []) accumulator.dependencies.add(key);
  for (const note of record.notes ?? []) accumulator.notes.add(note);
  for (const [target, values] of [
    [accumulator.host, record.host],
    [accumulator.external, record.external],
  ])
    for (const value of values ?? []) if (target.size < maximumSamples) target.add(value);
  for (const key of [
    "host",
    "loopback",
    "localSocket",
    "external",
    "clockNow",
    "clockConstruct",
    "clockUnattributed",
  ])
    accumulator.counts[key] += record.counts?.[key] ?? 0;
  if (record.counts?.childrenDropped) accumulator.truncated = true;
}

/** Walks a file's worker and every child it can match, so each observed descendant contributes. */
function collectFile(file, index, boundRecords) {
  const accumulator = createAccumulator();
  const visited = new Set();
  const queue = [...(boundRecords.get(file) ?? [])];
  while (queue.length > 0) {
    const record = queue.shift();
    if (visited.has(record)) continue;
    visited.add(record);
    absorb(accumulator, record);
    for (const child of record.children ?? []) {
      const count = child.count ?? 1;
      if (child.bootstrap) {
        accumulator.counts.bootstrap += count;
        continue;
      }
      accumulator.counts.spawned += count;
      if (child.failed) {
        accumulator.counts.failed += count;
        continue;
      }
      const matched = child.inherited ? childRecords(index, record, child, file) : [];
      if (matched.some(isComplete)) {
        accumulator.counts.observed += 1;
        queue.push(...matched);
      } else if (matched.length > 0) {
        // Its record never got the end marker: the child was killed or is still running.
        const name = `${child.command} (incomplete record)`;
        accumulator.unobserved.set(name, (accumulator.unobserved.get(name) ?? 0) + count);
        queue.push(...matched);
      } else if (child.command === "git") {
        // A working directory the recorder could not read may be the repository.
        if (child.cwd.startsWith("<") && child.cwd !== "<unknown>")
          accumulator.counts.gitOutsideRepository += count;
        else accumulator.counts.gitInRepository += count;
      } else {
        const name = child.inherited ? child.command : `${child.command} (no recorder)`;
        accumulator.unobserved.set(name, (accumulator.unobserved.get(name) ?? 0) + count);
      }
    }
  }
  return accumulator;
}

function trackedDirectoriesOf(tracked) {
  const directories = new Set();
  for (const path of tracked) {
    const parts = path.split("/");
    for (let length = 1; length < parts.length; length += 1)
      directories.add(parts.slice(0, length).join("/"));
  }
  return directories;
}

const listingPath = (key) => key.slice(key.indexOf("\0") + 1);

function classify(accumulator, { file, tracked, trackedDirectories, mappings, shardWrites }) {
  const reasons = new Set();
  const unobservedChildren = [...accumulator.unobserved.values()].reduce((sum, n) => sum + n, 0);
  if (unobservedChildren > 0) reasons.add("unobserved_child");
  const gitPaths = [...accumulator.inputs, ...accumulator.absent, ...accumulator.trees].some(
    (path) => path.startsWith(".git:"),
  );
  if (accumulator.counts.gitInRepository > 0 || gitPaths) reasons.add("git_in_repository");
  if (accumulator.counts.external > 0) reasons.add("network");
  if (accumulator.counts.host > 0) reasons.add("host_state");
  const known = (path) =>
    path === "." || tracked.has(path) || trackedDirectories.has(path) || mappings.has(path);
  const listed = [...accumulator.listings.keys()].map(listingPath);
  const untracked = [...accumulator.inputs, ...accumulator.trees, ...listed]
    .filter((path) => !path.startsWith(".git:") && !known(path))
    .sort();
  if (untracked.length > 0) reasons.add("untracked_input");
  if (
    !accumulator.completeWorker ||
    accumulator.truncated ||
    [...accumulator.notes].some((note) => incompleteNotes.has(note))
  )
    reasons.add("module_graph_unavailable");
  if ([...accumulator.notes].some((note) => unobservedNotes.has(note)))
    reasons.add("unobserved_input");
  const endedAt = accumulator.records === 0 ? Infinity : accumulator.endedAt;
  const written = shardWrites.writtenByOthers(
    file,
    [
      file,
      ...accumulator.inputs,
      ...accumulator.trees,
      ...listed,
      ...accumulator.absent,
      ...accumulator.dependencies,
    ],
    endedAt,
  );
  if (written !== null) reasons.add("shard_written_input");
  return {
    reasons: CI_TEST_UNCACHEABLE_REASONS.filter((reason) => reasons.has(reason)),
    untracked,
    written,
  };
}

/**
 * `results`: `[{ file, result, tests, durationMs, collectMs }]` from Vitest. `records`: parsed
 * spool records. `tracked`: Git-tracked paths. `generated`: generated outputs and their sources,
 * from `readBundleMetafile` and `readSchemaValidatorManifest`.
 * `workspaces`: workspace package name to directory.
 */
export function createCiTestLedger({
  results,
  records,
  tracked,
  generated,
  workspaces,
  toolchain,
  run,
}) {
  const index = indexRecords(records);
  const boundRecords = new Map();
  for (const record of records) {
    if (record.file === null) continue;
    if (!boundRecords.has(record.file)) boundRecords.set(record.file, []);
    boundRecords.get(record.file).push(record);
  }
  const collected = results.map((result) => ({
    result,
    accumulator: collectFile(result.file, index, boundRecords),
  }));
  const shardWrites = createCiTestShardWrites(
    records,
    (record, child) =>
      child.inherited === true &&
      childRecords(index, record, child, record.file).some((match) => isComplete(match)),
  );
  const repositoryPaths = new Set();
  for (const { accumulator } of collected)
    for (const path of [
      ...accumulator.inputs,
      ...accumulator.trees,
      ...[...accumulator.listings.keys()].map(listingPath),
    ])
      if (!path.startsWith(".git:")) repositoryPaths.add(path);
  const trackedDirectories = trackedDirectoriesOf(tracked);
  const { mappings, unmapped } = mapCiTestBuildOutputs({
    paths: repositoryPaths,
    tracked,
    trackedDirectories,
    generated,
    workspaces,
  });

  const table = new Map();
  const paths = [];
  const id = (path) => {
    if (!table.has(path)) {
      table.set(path, paths.length);
      paths.push(path);
    }
    return table.get(path);
  };
  const ids = (values) => [...values].sort().map(id);
  const reasonCounts = Object.fromEntries(CI_TEST_UNCACHEABLE_REASONS.map((reason) => [reason, 0]));
  const files = collected.map(({ result, accumulator }) => {
    const { reasons, untracked, written } = classify(accumulator, {
      file: result.file,
      tracked,
      trackedDirectories,
      mappings,
      shardWrites,
    });
    for (const reason of reasons) reasonCounts[reason] += 1;
    const { counts } = accumulator;
    return {
      file: result.file,
      result: result.result,
      tests: result.tests,
      durationMs: result.durationMs,
      collectMs: result.collectMs,
      inputs: ids(accumulator.inputs),
      listings: [...accumulator.listings]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([key, digests]) => [
          id(listingPath(key)),
          key.slice(0, key.indexOf("\0")),
          ...[...digests].sort(),
        ]),
      trees: ids(accumulator.trees),
      absent: ids(accumulator.absent),
      dependencies: ids(accumulator.dependencies),
      untracked: untracked.slice(0, maximumSamples).map(id),
      shardWritten: written,
      children: {
        bootstrap: counts.bootstrap,
        spawned: counts.spawned,
        observed: counts.observed,
        failed: counts.failed,
        gitOutsideRepository: counts.gitOutsideRepository,
        gitInRepository: counts.gitInRepository,
        unobserved: Object.fromEntries([...accumulator.unobserved].sort()),
      },
      network: {
        loopback: counts.loopback,
        localSocket: counts.localSocket,
        external: [...accumulator.external].sort(),
      },
      host: { reads: counts.host, samples: [...accumulator.host].sort() },
      clock: {
        now: counts.clockNow,
        construct: counts.clockConstruct,
        unattributed: counts.clockUnattributed,
      },
      processes: { records: accumulator.records, complete: accumulator.completeRecords },
      notes: [...accumulator.notes].sort(),
      uncacheableReasons: reasons,
      toolchainDigest: toolchain.digest,
    };
  });
  const reached = new Set(collected.map(({ result }) => result.file));
  return {
    schemaVersion: 1,
    contract: CI_TEST_LEDGER_CONTRACT,
    run,
    toolchain,
    paths,
    buildOutputs: [...mappings]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([output, { via, sources }]) => ({ output: id(output), via, sources: sources.map(id) })),
    unmappedBuildOutputs: [...unmapped].sort().map(id),
    files,
    summary: {
      files: files.length,
      cacheable: files.filter((file) => file.uncacheableReasons.length === 0).length,
      reasons: reasonCounts,
      records: records.length,
      shardWrites: shardWrites.size,
      // Each unseen writer taints the files that finish after it starts; the first ones matter.
      unseenWriters: shardWrites.unseenWriters.slice(0, maximumSamples),
      unboundRecords: records.filter((record) => record.file === null || !reached.has(record.file))
        .length,
    },
  };
}
