import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import {
  loadRepositoryKnowledgePolicy,
  scanConfiguredRepositoryKnowledge,
} from "@lervo/repository-knowledge";

import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";

const KNOWLEDGE_SNAPSHOT_CACHE = ".lervo/state/cache/terminal-knowledge-snapshot.json";

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
      await readFile(resolve(root, KNOWLEDGE_SNAPSHOT_CACHE), "utf8"),
    ) as CachedKnowledgeSnapshot;
    return value?.schemaVersion === 1 && /^ksnap_[a-f0-9]{24}$/u.test(value.sourceSnapshotId)
      ? value
      : null;
  } catch {
    return null;
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
  if ((await captureTerminalRepositorySnapshot(root)).revision === repositoryRevision) {
    const value: CachedKnowledgeSnapshot = {
      schemaVersion: 1,
      repositoryRevision,
      projectId: manifest.projectId,
      policyId: policy.policyId,
      sourceSnapshotId: scan.snapshotId,
    };
    try {
      const target = resolve(root, KNOWLEDGE_SNAPSHOT_CACHE);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(`${target}.${process.pid}.tmp`, JSON.stringify(value), { mode: 0o600 });
      await rename(`${target}.${process.pid}.tmp`, target);
    } catch {
      // The cache only saves time on the next prompt.
    }
  }
  return scan.snapshotId;
}

/** Stop runs this detached so the next prompt finds the post-turn knowledge snapshot ready. */
export async function prefetchTerminalPromptContext(root: string): Promise<void> {
  const snapshot = await captureTerminalRepositorySnapshot(root);
  await terminalKnowledgeSnapshotId(root, snapshot.revision);
}
