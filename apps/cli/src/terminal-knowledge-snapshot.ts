import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { readRepositoryFile } from "@lervo/context";
import { loadProjectManifest } from "@lervo/project";
import {
  loadRepositoryKnowledgePolicy,
  scanConfiguredRepositoryKnowledge,
} from "@lervo/repository-knowledge";

import {
  captureTerminalRepositorySnapshot,
  captureTerminalRepositorySnapshotWithoutDeadline,
} from "./terminal-repository-snapshot.js";
import { resolveCommandRoots } from "./terminal-roots.js";

const KNOWLEDGE_SNAPSHOT_CACHE = ".lervo/state/cache/terminal-knowledge-snapshot.json";
const MAXIMUM_CACHE_BYTES = 8 * 1024;
const TEMPORARY_NAME =
  /^(?:\.terminal-knowledge-snapshot-[a-f0-9-]{36}|terminal-knowledge-snapshot\.json\.[1-9][0-9]*)\.tmp$/u;

interface CachedKnowledgeSnapshot {
  schemaVersion: 1;
  repositoryRevision: string;
  projectId: string;
  policyId: string;
  sourceSnapshotId: string;
}

async function readKnowledgeSnapshotCache(root: string): Promise<CachedKnowledgeSnapshot | null> {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readRepositoryFile(root, KNOWLEDGE_SNAPSHOT_CACHE, MAXIMUM_CACHE_BYTES),
      ),
    ) as CachedKnowledgeSnapshot;
    return value?.schemaVersion === 1 && /^ksnap_[a-f0-9]{24}$/u.test(value.sourceSnapshotId)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function cacheDirectory(root: string): Promise<string | null> {
  try {
    let path = resolve(root);
    const rootStats = await lstat(path);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return null;
    for (const part of [".lervo", "state", "cache"]) {
      path = resolve(path, part);
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const stats = await lstat(path);
      if (!stats.isDirectory() || stats.isSymbolicLink()) return null;
    }
    return path;
  } catch {
    return null;
  }
}

async function writeKnowledgeSnapshotCache(
  root: string,
  directory: string,
  value: CachedKnowledgeSnapshot,
): Promise<void> {
  let temporary: string | undefined;
  let handle;
  try {
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content) > MAXIMUM_CACHE_BYTES) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      // Losing a racing producer's temporary file causes only a cache miss.
      if (entry.isFile() && TEMPORARY_NAME.test(entry.name))
        await rm(resolve(directory, entry.name), { force: true }).catch(() => undefined);
    }
    const candidate = resolve(directory, `.terminal-knowledge-snapshot-${randomUUID()}.tmp`);
    handle = await open(
      candidate,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    temporary = candidate;
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, resolve(root, KNOWLEDGE_SNAPSHOT_CACHE));
  } catch {
    // Persistence is optional; return the freshly computed snapshot on failure.
  } finally {
    await handle?.close().catch(() => undefined);
    if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/**
 * Knowledge snapshot identity is a pure function of repository bytes and policy, so it is cached by
 * the exact repository revision. Stop prefetches it for the post-turn bytes; a revision mismatch
 * recomputes it, and a concurrent edit during the scan is never cached.
 */
export async function terminalKnowledgeSnapshotId(
  root: string,
  repositoryRevision: string,
): Promise<string> {
  const [cached, manifest, policy] = await Promise.all([
    readKnowledgeSnapshotCache(root),
    loadProjectManifest(root),
    loadRepositoryKnowledgePolicy(root),
  ]);
  if (
    cached?.repositoryRevision === repositoryRevision &&
    cached.projectId === manifest.projectId &&
    cached.policyId === policy.policyId
  )
    return cached.sourceSnapshotId;
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  const directory = await cacheDirectory(root);
  // The confirmation ignores the hook's deadline: a prompt whose scan overran still caches it, so
  // the next prompt in a cold checkout, such as a new linked worktree, finds it ready.
  if (
    directory !== null &&
    (await captureTerminalRepositorySnapshotWithoutDeadline(root)).revision === repositoryRevision
  ) {
    const value: CachedKnowledgeSnapshot = {
      schemaVersion: 1,
      repositoryRevision,
      projectId: manifest.projectId,
      policyId: policy.policyId,
      sourceSnapshotId: scan.snapshotId,
    };
    await writeKnowledgeSnapshotCache(root, directory, value);
  }
  return scan.snapshotId;
}

/**
 * The knowledge snapshot a linked worktree's prompts are ranked against: its registered
 * repository's, which the resident keeps warm after each commit (ADR-0633). A worktree never scans
 * its own knowledge, which in a large repository takes longer than a hook may run. Null when the
 * repository has none cached for its project and policy.
 */
export async function repositoryKnowledgeSnapshotId(root: string): Promise<string | null> {
  const [cached, manifest, policy] = await Promise.all([
    readKnowledgeSnapshotCache(root),
    loadProjectManifest(root),
    loadRepositoryKnowledgePolicy(root),
  ]);
  return cached !== null &&
    cached.projectId === manifest.projectId &&
    cached.policyId === policy.policyId
    ? cached.sourceSnapshotId
    : null;
}

/** Whether this checkout has a prompt knowledge snapshot cached, and for which revision. */
export async function cachedKnowledgeSnapshotRevision(root: string): Promise<string | null> {
  return (await readKnowledgeSnapshotCache(root))?.repositoryRevision ?? null;
}

/**
 * Stop runs this detached so the next prompt finds the post-turn snapshot and knowledge snapshot
 * ready. The core health projection is computed by resident cycles, not here, so the hook bundle
 * only reads it. A linked worktree warms only its own file hashes; its prompts use the registered
 * repository's knowledge snapshot, which this computes only when none is cached (ADR-0633).
 */
export async function prefetchTerminalPromptContext(root: string): Promise<void> {
  const roots = await resolveCommandRoots(root);
  const snapshot = await captureTerminalRepositorySnapshot(roots.executionRoot);
  if (roots.evidenceRoot === roots.executionRoot) {
    await terminalKnowledgeSnapshotId(roots.executionRoot, snapshot.revision);
    return;
  }
  if ((await repositoryKnowledgeSnapshotId(roots.evidenceRoot)) !== null) return;
  const repository = await captureTerminalRepositorySnapshot(roots.evidenceRoot);
  await terminalKnowledgeSnapshotId(roots.evidenceRoot, repository.revision);
}
