import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Private, rebuildable publication progress for this checkout (ADR-0466). */
export const KNOWLEDGE_PUBLICATION_STATE_PATH = ".lervo/state/knowledge/knowledge-publication.json";

/**
 * - `idle`: nothing is unpublished.
 * - `awaiting_checks`: the pull request is open and its checks have not all finished.
 * - `open`: the pull request is open and merging is disabled or waits for a person.
 * - `merged`: the last pull request merged and the local base branch caught up.
 * - `local_diverged`: the pull request merged, but the local base branch also holds other
 *   unpublished commits, so it was left for its owner to pull or rebase.
 * - `failed`: the last attempt failed; `failure` names the stage and code.
 */
export type KnowledgePublicationStatus =
  "idle" | "awaiting_checks" | "open" | "merged" | "local_diverged" | "failed";

export type KnowledgePublicationFailureCode =
  | "knowledge_publication_fetch_failed"
  | "knowledge_publication_scope_violation"
  | "knowledge_publication_conflict"
  | "knowledge_publication_push_failed"
  | "knowledge_publication_pull_request_failed"
  | "knowledge_publication_checks_failed"
  | "knowledge_publication_merge_failed";

export interface KnowledgePublicationFailure {
  code: KnowledgePublicationFailureCode;
  /** Bounded, path-free diagnostic such as a Git exit code or a check count. */
  detail: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  occurrences: number;
}

export interface KnowledgePublicationState {
  schemaVersion: 1;
  status: KnowledgePublicationStatus;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  publishedHead: string | null;
  commitCount: number;
  updatedAt: string;
  failure: KnowledgePublicationFailure | null;
}

const STATUSES = new Set(["idle", "awaiting_checks", "open", "merged", "local_diverged", "failed"]);

/** Missing or invalid state reads as null; the next publication rebuilds it from Git and GitHub. */
export async function readKnowledgePublicationState(
  root: string,
): Promise<KnowledgePublicationState | null> {
  try {
    const path = resolve(root, KNOWLEDGE_PUBLICATION_STATE_PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 8_192) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<KnowledgePublicationState>;
    return value?.schemaVersion === 1 &&
      typeof value.status === "string" &&
      STATUSES.has(value.status)
      ? (value as KnowledgePublicationState)
      : null;
  } catch {
    return null;
  }
}

export async function writeKnowledgePublicationState(
  root: string,
  state: KnowledgePublicationState,
): Promise<void> {
  let directory = resolve(root);
  for (const part of [".lervo", "state", "knowledge"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Knowledge publication state directory is invalid.");
  }
  const temporary = resolve(directory, `.knowledge-publication-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, KNOWLEDGE_PUBLICATION_STATE_PATH));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Repeats of one failure code keep their first observation and count, so attention stays one item. */
export function nextKnowledgePublicationFailure(
  previous: KnowledgePublicationFailure | null,
  code: KnowledgePublicationFailureCode,
  detail: string | null,
  at: string,
): KnowledgePublicationFailure {
  return previous !== null && previous.code === code
    ? {
        ...previous,
        detail,
        lastObservedAt: at,
        occurrences: Math.min(previous.occurrences + 1, 1_000_000),
      }
    : { code, detail, firstObservedAt: at, lastObservedAt: at, occurrences: 1 };
}
