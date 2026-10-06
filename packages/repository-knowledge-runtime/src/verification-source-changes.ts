import { captureRepositorySnapshot } from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  replayKnowledgeConvergence,
  sha256,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";
import type { ArtifactStore } from "@lervo/storage-contract";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/**
 * ADR-0482: a pinned verification suite changed repository files while it ran, so its result
 * cannot verify the reviewed bytes. Retrying runs the same suite again and changes the same files;
 * the owner decides, for example by committing the bytes the suite produces.
 */
export const VERIFICATION_MODIFIED_SOURCES = "knowledge_verification_modified_sources";

const MAXIMUM_RECORDED_PATHS = 256;

export interface ObservedRepositoryState {
  revision: string;
  /** Repository-relative path to content hash. */
  files: ReadonlyMap<string, string>;
}

/** The isolated-workspace snapshot the orchestrator already fences, with its per-file hashes. */
export async function observedRepositorySnapshot(root: string): Promise<ObservedRepositoryState> {
  const snapshot = await captureRepositorySnapshot(root);
  return { revision: snapshot.revision, files: new Map(Object.entries(snapshot.files)) };
}

/** Paths added, removed, or changed between two exact repository observations. */
export function changedRepositoryPaths(
  before: ObservedRepositoryState,
  after: ObservedRepositoryState,
): string[] {
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  return [...paths].filter((path) => before.files.get(path) !== after.files.get(path)).sort();
}

/**
 * Wraps the revision capture the verification runner calls before and after the suite, keeping the
 * first and latest observations so a changed revision can be explained by exact paths.
 */
export function observeVerificationRevisions(
  capture: (root: string) => Promise<ObservedRepositoryState>,
) {
  let first: ObservedRepositoryState | null = null;
  let latest: ObservedRepositoryState | null = null;
  return {
    captureRepositoryRevision: async (root: string): Promise<string> => {
      const observed = await capture(root);
      first ??= observed;
      latest = observed;
      return observed.revision;
    },
    changedPaths: (): string[] =>
      first === null || latest === null ? [] : changedRepositoryPaths(first, latest),
  };
}

/**
 * Runs one suite. When the runner reports `repository_changed_during_verification`, the exact
 * changed paths become private evidence and the typed `knowledge_verification_modified_sources`.
 */
export async function withVerificationSourceChanges<T>(
  artifacts: ArtifactStore,
  capture: (root: string) => Promise<ObservedRepositoryState>,
  run: (captureRepositoryRevision: (root: string) => Promise<string>) => Promise<T>,
): Promise<T> {
  const observer = observeVerificationRevisions(capture);
  try {
    return await run(observer.captureRepositoryRevision);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== "repository_changed_during_verification")
      throw error;
    const paths = observer.changedPaths();
    if (paths.length === 0) throw error;
    const evidence = await artifacts.put(
      canonicalJson({
        schemaVersion: 1,
        kind: "verification_source_changes",
        code: VERIFICATION_MODIFIED_SOURCES,
        changedPathCount: paths.length,
        paths: paths.slice(0, MAXIMUM_RECORDED_PATHS),
      }),
    );
    throw Object.assign(
      new KnowledgeConvergenceRuntimeError(VERIFICATION_MODIFIED_SOURCES, { cause: error }),
      { dependencyHash: evidence.contentHash },
    );
  }
}

async function readArtifact(
  artifacts: ArtifactStore,
  hash: unknown,
): Promise<Record<string, unknown> | null> {
  if (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash)) return null;
  try {
    const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    if (sha256(bytes) !== hash) return null;
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/**
 * Adds the exact changed paths to an owner-local status. The stage dependency names its evidence;
 * an assignment failure proof names the verification evidence one level further.
 */
export async function withVerificationChangesStatus(
  storage: Pick<ProjectStorage, "artifacts" | "events">,
  status: KnowledgeConvergenceStatus,
): Promise<KnowledgeConvergenceStatus> {
  if (status.reason !== VERIFICATION_MODIFIED_SOURCES) return status;
  const active = replayKnowledgeConvergence(storage.events).find((row) => row.outcome === null);
  let evidence = await readArtifact(storage.artifacts, active?.latest?.payload.dependencyHash);
  for (let depth = 0; depth < 2 && evidence?.kind !== "verification_source_changes"; depth++)
    evidence = await readArtifact(storage.artifacts, evidence?.evidenceHash);
  if (
    evidence?.kind !== "verification_source_changes" ||
    typeof evidence.changedPathCount !== "number" ||
    !Array.isArray(evidence.paths) ||
    !evidence.paths.every((path) => typeof path === "string")
  )
    return status;
  return {
    ...status,
    verificationChanges: {
      changedPathCount: evidence.changedPathCount,
      paths: evidence.paths as string[],
    },
  };
}
