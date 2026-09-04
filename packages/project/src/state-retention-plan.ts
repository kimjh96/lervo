import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { resolveProjectPaths } from "./layout.js";
import {
  defaultStateRetentionPolicy,
  type PrunableStateClass,
  type StatePruneOperation,
  type StatePrunePlan,
  type StatePrunePublicPlan,
  type StateRetentionClass,
  type StateRetentionClassSummary,
  type StateRetentionEvidence,
  type StateRetentionPolicy,
} from "./state-retention-types.js";

interface FileCoordinate {
  relativePath: string;
  bytes: number;
  hash: string;
  modifiedMs: number;
}

interface Artifact {
  relativePath: string;
  retentionClass: StateRetentionClass;
  files: FileCoordinate[];
  byteCount: number;
  modifiedMs: number;
  contentDigest: string;
}

const maximumFiles = 100_000;
const maximumBytes = 8 * 1024 * 1024 * 1024;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

async function inventoryFiles(stateRoot: string): Promise<FileCoordinate[]> {
  const files: FileCoordinate[] = [];
  let bytes = 0;
  async function visit(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Derived state contains a symbolic link.");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const stats = await lstat(path);
        bytes += stats.size;
        files.push({
          relativePath: relative(stateRoot, path).split(sep).join("/"),
          bytes: stats.size,
          hash: await hashFile(path),
          modifiedMs: stats.mtimeMs,
        });
      } else throw new Error("Derived state contains an unsupported filesystem entry.");
      if (files.length > maximumFiles || bytes > maximumBytes)
        throw new Error("Derived state exceeds the bounded prune inventory.");
    }
  }
  try {
    await visit(stateRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return files;
}

function classify(path: string, evidence: StateRetentionEvidence): StateRetentionClass {
  const parts = path.split("/");
  if (path.startsWith("knowledge/normalization-shards/") || path.startsWith("knowledge/indexes/"))
    return "rebuildable_cache";
  if (path.startsWith("knowledge/normalization-candidates/")) {
    const candidateId = parts.at(-1)?.replace(/\.json$/u, "") ?? "";
    return evidence.completedNormalizationCandidateIds.has(candidateId)
      ? "rebuildable_cache"
      : "pending_review";
  }
  if (path.startsWith("knowledge/canonicalization-candidates/")) {
    const candidateId = parts.at(-1)?.replace(/\.json$/u, "") ?? "";
    return evidence.completedCanonicalizationCandidateIds.has(candidateId)
      ? "rebuildable_cache"
      : "pending_review";
  }
  if (parts[0] === "deliberations" && parts[1]) {
    if (evidence.activeDeliberationIds.has(parts[1])) return "recovery_required";
    return evidence.completedDeliberationIds.has(parts[1])
      ? "completed_workspace"
      : "recovery_required";
  }
  if (path.startsWith("search/performance-reports/") || path.startsWith("environment/"))
    return "bounded_observation";
  if (path.includes("checkpoint") || path.includes("transaction") || path.includes("recovery"))
    return "recovery_required";
  return "replace_current";
}

function artifactKey(file: FileCoordinate, retentionClass: StateRetentionClass): string {
  const parts = file.relativePath.split("/");
  if (retentionClass === "completed_workspace" || retentionClass === "recovery_required") {
    if (parts[0] === "deliberations" && parts[1]) return `${parts[0]}/${parts[1]}`;
  }
  return file.relativePath;
}

function buildArtifacts(files: FileCoordinate[], evidence: StateRetentionEvidence): Artifact[] {
  const groups = new Map<
    string,
    { retentionClass: StateRetentionClass; files: FileCoordinate[] }
  >();
  for (const file of files) {
    const retentionClass = classify(file.relativePath, evidence);
    const key = artifactKey(file, retentionClass);
    const group = groups.get(key);
    if (group) group.files.push(file);
    else groups.set(key, { retentionClass, files: [file] });
  }
  return [...groups.entries()].map(([relativePath, group]) => {
    const ordered = group.files.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath));
    return {
      relativePath,
      retentionClass: group.retentionClass,
      files: ordered,
      byteCount: ordered.reduce((sum, file) => sum + file.bytes, 0),
      modifiedMs: Math.max(...ordered.map((file) => file.modifiedMs)),
      contentDigest: sha256(JSON.stringify(ordered)),
    };
  });
}

function selectOperations(
  artifacts: Artifact[],
  policy: StateRetentionPolicy,
  nowMs: number,
): StatePruneOperation[] {
  const selected: StatePruneOperation[] = [];
  for (const retentionClass of Object.keys(policy) as PrunableStateClass[]) {
    const limits = policy[retentionClass];
    const candidates = artifacts
      .filter((item) => item.retentionClass === retentionClass)
      .toSorted(
        (a, b) => b.modifiedMs - a.modifiedMs || a.relativePath.localeCompare(b.relativePath),
      );
    let retainedBytes = 0;
    for (const [index, item] of candidates.entries()) {
      retainedBytes += item.byteCount;
      const reason =
        nowMs - item.modifiedMs > limits.maxAgeMs
          ? "age_limit"
          : index >= limits.maxCount
            ? "count_limit"
            : retainedBytes > limits.maxBytes
              ? "byte_limit"
              : null;
      if (reason === null) continue;
      const pathDigest = sha256(item.relativePath);
      selected.push({
        operationId: `stpr_${sha256(`${pathDigest}:${item.contentDigest}`).slice(7, 31)}`,
        relativePath: item.relativePath,
        pathDigest,
        retentionClass,
        reason,
        fileCount: item.files.length,
        byteCount: item.byteCount,
        contentDigest: item.contentDigest,
        modifiedAt: new Date(item.modifiedMs).toISOString(),
      });
    }
  }
  return selected.toSorted((a, b) => a.operationId.localeCompare(b.operationId));
}

function summarize(
  artifacts: Artifact[],
  operations: StatePruneOperation[],
): StateRetentionClassSummary[] {
  return [
    "replace_current",
    "rebuildable_cache",
    "pending_review",
    "completed_workspace",
    "bounded_observation",
    "recovery_required",
  ].map((retentionClass) => {
    const members = artifacts.filter((item) => item.retentionClass === retentionClass);
    const selected = operations.filter((item) => item.retentionClass === retentionClass);
    return {
      retentionClass: retentionClass as StateRetentionClass,
      artifactCount: members.length,
      fileCount: members.reduce((sum, item) => sum + item.files.length, 0),
      byteCount: members.reduce((sum, item) => sum + item.byteCount, 0),
      reclaimableArtifactCount: selected.length,
      reclaimableFileCount: selected.reduce((sum, item) => sum + item.fileCount, 0),
      reclaimableBytes: selected.reduce((sum, item) => sum + item.byteCount, 0),
    };
  });
}

export async function planStatePrune(input: {
  repositoryRoot: string;
  evidence: StateRetentionEvidence;
  blockers?: readonly string[];
  policy?: StateRetentionPolicy;
  now?: Date;
}): Promise<StatePrunePlan> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const stateRoot = resolveProjectPaths(repositoryRoot).state;
  const policy = input.policy ?? defaultStateRetentionPolicy;
  const files = await inventoryFiles(stateRoot);
  const artifacts = buildArtifacts(files, input.evidence);
  const operations = selectOperations(artifacts, policy, (input.now ?? new Date()).getTime());
  const policyHash = sha256(JSON.stringify(policy));
  const retentionInventory = artifacts
    .filter((item) => item.retentionClass !== "replace_current")
    .map(({ relativePath, retentionClass, contentDigest, byteCount, modifiedMs }) => ({
      relativePath,
      retentionClass,
      contentDigest,
      byteCount,
      modifiedMs,
    }))
    .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  const inventoryDigest = sha256(JSON.stringify(retentionInventory));
  const blockers = [...(input.blockers ?? [])].toSorted();
  const planDigest = sha256(JSON.stringify({ policyHash, inventoryDigest, blockers, operations }));
  return {
    schemaVersion: 1,
    planKind: "derived_state_prune",
    planId: `kstateprune_${planDigest.slice(7, 31)}`,
    repositoryRoot,
    status: blockers.length > 0 ? "blocked" : operations.length > 0 ? "ready" : "current",
    policyHash,
    inventoryDigest,
    inspectedAt: (input.now ?? new Date()).toISOString(),
    durableDataPath: ".lervo/data",
    durableDataDisposition: "preserved",
    blockers,
    summaries: summarize(artifacts, operations),
    operations,
  };
}

export function publicStatePrunePlan(plan: StatePrunePlan): StatePrunePublicPlan {
  return {
    ...plan,
    operations: plan.operations.map(
      ({ relativePath: _path, contentDigest: _digest, ...item }) => item,
    ),
  };
}
