import { dirname } from "node:path";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  replayKnowledgeConvergence,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";

/**
 * Every pending normalization document lies outside the delegated normalization roots. Extending
 * the roots widens reviewed authority, so only the owner can resolve it.
 */
export const NORMALIZATION_OUTSIDE_DELEGATION = "knowledge_normalization_outside_delegation";

const MAXIMUM_RECORDED_PATHS = 256;

/**
 * Each document's parent directory, or the file itself at the repository root, collapsed to the
 * outermost entries: the narrowest roots that a delegation would have to add.
 */
export function outsideNormalizationRoots(paths: readonly string[]): string[] {
  const candidates = [
    ...new Set(paths.map((path) => (path.includes("/") ? dirname(path) : path))),
  ].sort();
  return candidates.filter(
    (candidate) =>
      !candidates.some((other) => other !== candidate && candidate.startsWith(`${other}/`)),
  );
}

/** Private dependency for the waiting stage; it binds the exact pending set it observed. */
export function normalizationScopeGap(state: KnowledgeConvergenceInput, pending: string[]) {
  const paths = pending.toSorted();
  return {
    schemaVersion: 1,
    kind: "normalization_scope",
    code: NORMALIZATION_OUTSIDE_DELEGATION,
    snapshotHash: state.snapshotHash,
    delegationHash: state.baseline.delegationHash,
    pendingDocuments: paths.length,
    outsideRoots: outsideNormalizationRoots(paths),
    paths: paths.slice(0, MAXIMUM_RECORDED_PATHS),
  };
}

/** Adds the repository-relative roots that block normalization to an owner-local status. */
export async function withNormalizationScopeGap(
  storage: ProjectStorage,
  status: KnowledgeConvergenceStatus,
): Promise<KnowledgeConvergenceStatus> {
  if (status.reason !== NORMALIZATION_OUTSIDE_DELEGATION) return status;
  const active = replayKnowledgeConvergence(storage.events).find((row) => row.outcome === null);
  const hash = active?.latest?.payload.dependencyHash;
  if (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash)) return status;
  try {
    const bytes = await storage.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    if (sha256(bytes) !== hash) return status;
    const gap = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as {
      code?: unknown;
      pendingDocuments?: unknown;
      outsideRoots?: unknown;
    };
    if (
      gap.code !== NORMALIZATION_OUTSIDE_DELEGATION ||
      typeof gap.pendingDocuments !== "number" ||
      !Array.isArray(gap.outsideRoots) ||
      !gap.outsideRoots.every((root) => typeof root === "string")
    )
      return status;
    return {
      ...status,
      scopeGap: {
        pendingDocuments: gap.pendingDocuments,
        outsideNormalizationRoots: gap.outsideRoots as string[],
      },
    };
  } catch {
    return status;
  }
}
