import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  readJournal,
  transactionRoot,
  type KnowledgeMaterializationJournal,
} from "./materialization-journal.js";
import { RepositoryKnowledgeError } from "./types.js";

/** The only command that may clear an interrupted materialization marker. */
export const KNOWLEDGE_MATERIALIZATION_RECOVERY_COMMAND = "lervo knowledge materialize --recover";

export interface LiveKnowledgeMaterializationOwner {
  state: "live";
  ownerPid: number;
  planId: string;
  phase: KnowledgeMaterializationJournal["phase"];
}

export type KnowledgeMaterializationOwner =
  { state: "none" } | LiveKnowledgeMaterializationOwner | { state: "interrupted" };

/** A journal owned by the current process is never live to itself: it cannot wait on itself. */
export function materializationOwnerAlive(pid: number): boolean {
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function markerPresent(root: string): Promise<boolean> {
  try {
    const stat = await lstat(transactionRoot(root));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new RepositoryKnowledgeError(
        "knowledge_recovery_invalid",
        "The knowledge materialization transaction marker is unsafe.",
      );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Classify the materialization marker without changing it. A journal owned by another running
 * process is `live` and settles on its own; any other marker is `interrupted` and keeps requiring
 * explicit `lervo knowledge materialize --recover`.
 */
export async function describeKnowledgeMaterializationOwner(input: {
  repositoryRoot: string;
}): Promise<KnowledgeMaterializationOwner> {
  const root = resolve(input.repositoryRoot);
  if (!(await markerPresent(root))) return { state: "none" };
  let journal: KnowledgeMaterializationJournal;
  try {
    journal = await readJournal(root);
  } catch (error) {
    if (error instanceof RepositoryKnowledgeError && error.code === "knowledge_recovery_not_found")
      return { state: "none" };
    return { state: "interrupted" };
  }
  return materializationOwnerAlive(journal.ownerPid)
    ? { state: "live", ownerPid: journal.ownerPid, planId: journal.planId, phase: journal.phase }
    : { state: "interrupted" };
}

export async function inspectKnowledgeMaterializationOwner(input: {
  repositoryRoot: string;
}): Promise<"none" | "live" | "interrupted"> {
  return (await describeKnowledgeMaterializationOwner(input)).state;
}

export function liveKnowledgeMaterializationLabel(
  owner: LiveKnowledgeMaterializationOwner,
): string {
  return `process ${owner.ownerPid} (plan ${owner.planId}, phase ${owner.phase})`;
}

/** The refusal for a marker; only an interrupted marker names the recovery command. */
export function knowledgeMaterializationMarkerError(
  owner: LiveKnowledgeMaterializationOwner | { state: "interrupted" },
): RepositoryKnowledgeError {
  return new RepositoryKnowledgeError(
    "knowledge_recovery_required",
    owner.state === "live"
      ? `A live knowledge materialization owned by ${liveKnowledgeMaterializationLabel(owner)} is still running; retry after it settles.`
      : `The previous knowledge materialization transaction was interrupted and must be recovered first: run \`${KNOWLEDGE_MATERIALIZATION_RECOVERY_COMMAND}\`.`,
  );
}

/**
 * Refuses immediately while any marker exists. Background and runtime callers retry on their own
 * schedules; foreground commands wait for a live owner through a materialization settlement.
 */
export async function assertNoKnowledgeMaterializationTransaction(input: {
  repositoryRoot: string;
  allowedPlanId?: string;
}): Promise<void> {
  const root = resolve(input.repositoryRoot);
  if (!(await markerPresent(root))) return;
  if (input.allowedPlanId !== undefined) {
    const journal = await readJournal(root);
    if (journal.planId === input.allowedPlanId && journal.ownerPid === process.pid) return;
  }
  const owner = await describeKnowledgeMaterializationOwner({ repositoryRoot: root });
  if (owner.state === "none") return;
  throw knowledgeMaterializationMarkerError(owner);
}
