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
 * - `superseded`: the knowledge commits conflicted with the current remote base, so they were
 *   not published; `failure` carries `knowledge_publication_superseded`.
 * - `failed`: the last attempt failed; `failure` names the stage and code.
 */
export type KnowledgePublicationStatus =
  "idle" | "awaiting_checks" | "open" | "merged" | "local_diverged" | "superseded" | "failed";

export type KnowledgePublicationFailureCode =
  | "knowledge_publication_fetch_failed"
  | "knowledge_publication_scope_violation"
  | "knowledge_publication_conflict"
  | "knowledge_publication_push_failed"
  | "knowledge_publication_pull_request_failed"
  | "knowledge_publication_checks_failed"
  | "knowledge_publication_merge_failed"
  | "knowledge_publication_superseded";

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
  /**
   * Knowledge commits a replay conflict superseded while the local branch kept them, newest
   * last and at most 64; they are never selected again. Absent in state written before it existed.
   */
  supersededCommits?: string[];
  /**
   * ADR-0596: failed checks on one published head. The publisher reruns its transient Actions
   * failures once per head, then waits out `retryAt` while the head and the unpublished commits
   * stay the same. Absent in state written before it existed or for a head without failures.
   */
  checksRetry?: KnowledgePublicationChecksRetry;
}

export interface KnowledgePublicationChecksRetry {
  /** The published head whose checks failed. */
  head: string;
  /** Digest of the local base and the unpublished knowledge commits; a change ends the wait. */
  inventoryKey: string;
  /** Failed observations of this head after its rerun; selects the backoff step. */
  attempts: number;
  /** No check is read again for this head before this instant, unless the inventory changed. */
  retryAt: string;
  /** Whether this head's failed Actions runs were already started again. */
  rerun: boolean;
}

/** ADR-0596: waits between failed-check observations of one unchanged head: 15 min, 1 h, then 6 h. */
export const KNOWLEDGE_PUBLICATION_CHECKS_BACKOFF_MS = [
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;

export function knowledgePublicationChecksBackoff(attempts: number): number {
  const steps = KNOWLEDGE_PUBLICATION_CHECKS_BACKOFF_MS;
  return steps[Math.min(Math.max(attempts, 1), steps.length) - 1]!;
}

/** Bounds `supersededCommits`; older entries drop out and, if still local, conflict once more. */
export const MAXIMUM_SUPERSEDED_COMMITS = 64;

const STATUSES = new Set([
  "idle",
  "awaiting_checks",
  "open",
  "merged",
  "local_diverged",
  "superseded",
  "failed",
]);
const COMMIT = /^[0-9a-f]{40,64}$/u;

function validChecksRetry(value: unknown): value is KnowledgePublicationChecksRetry {
  const retry = value as Partial<KnowledgePublicationChecksRetry> | null;
  return (
    retry !== null &&
    typeof retry === "object" &&
    typeof retry.head === "string" &&
    COMMIT.test(retry.head) &&
    typeof retry.inventoryKey === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(retry.inventoryKey) &&
    Number.isSafeInteger(retry.attempts) &&
    retry.attempts! >= 0 &&
    typeof retry.retryAt === "string" &&
    !Number.isNaN(Date.parse(retry.retryAt)) &&
    typeof retry.rerun === "boolean"
  );
}

/**
 * Missing or invalid state reads as null; the next publication rebuilds it from Git and GitHub.
 * An invalid `checksRetry` alone is dropped, which costs at most one early check read.
 */
export async function readKnowledgePublicationState(
  root: string,
): Promise<KnowledgePublicationState | null> {
  try {
    const path = resolve(root, KNOWLEDGE_PUBLICATION_STATE_PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 8_192) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<KnowledgePublicationState>;
    if (value?.checksRetry !== undefined && !validChecksRetry(value.checksRetry))
      delete value.checksRetry;
    return value?.schemaVersion === 1 &&
      typeof value.status === "string" &&
      STATUSES.has(value.status) &&
      (value.supersededCommits === undefined ||
        (Array.isArray(value.supersededCommits) &&
          value.supersededCommits.length <= MAXIMUM_SUPERSEDED_COMMITS &&
          value.supersededCommits.every((sha) => typeof sha === "string" && COMMIT.test(sha))))
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
