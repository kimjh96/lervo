import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { canonicalJson, sha256, stableId } from "./integrity.js";
import type { RepositoryLayoutMigrationPlan } from "./repository-layout-migration.js";

/** Host-private, like the semantic classification records the plan is built from (ADR-0559). */
export const repositoryLayoutDecisionStatePath = ".lervo/state/knowledge/layout-decision.json";
const MAXIMUM_STATE_BYTES = 64 * 1024;
const MAXIMUM_DECLINED = 32;
const MAXIMUM_DESTINATIONS = 8;
const TOKEN = /^(klaydec_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u;

type DecisionPlan = Pick<
  RepositoryLayoutMigrationPlan,
  | "planId"
  | "sourceSnapshotId"
  | "afterSourceSnapshotId"
  | "status"
  | "moves"
  | "userUpdates"
  | "referenceUpdates"
  | "blockers"
  | "deferredDocumentCount"
>;

/**
 * ADR-0559: every item approval of one reviewed layout plan, asked as one owner decision.
 * `decisionHash` binds the exact source bytes, the exact resulting bytes, and every item's
 * approval hash, so accepting it grants exactly what passing each displayed `--approve-item`
 * would grant. It leaves out deferral labels, which change with provider availability.
 */
export interface RepositoryLayoutDecision {
  decisionId: string;
  decisionHash: string;
  planId: string;
  recommendation: "accept";
  moveCount: number;
  userUpdateCount: number;
  referenceUpdateCount: number;
  /** Destination directories with their move counts, largest first, at most 8. */
  destinations: Array<{ directory: string; count: number }>;
  /** Documents the plan still defers; a later decision covers them once they are routed. */
  deferredCount: number;
}

function approvals(plan: DecisionPlan): Array<{ operationId: string; approvalHash: string }> {
  return [...plan.moves, ...plan.userUpdates]
    .map((item) => ({ operationId: item.operationId, approvalHash: item.approvalHash }))
    .sort((left, right) =>
      left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0,
    );
}

/** The one decision a plan asks for, or null when it needs no owner approval. */
export function repositoryLayoutDecision(plan: DecisionPlan): RepositoryLayoutDecision | null {
  const items = approvals(plan);
  if (plan.status !== "review_required" || plan.blockers.length > 0 || items.length === 0)
    return null;
  const decisionHash = sha256(
    canonicalJson({
      sourceSnapshotId: plan.sourceSnapshotId,
      afterSourceSnapshotId: plan.afterSourceSnapshotId,
      approvals: items,
    }),
  );
  const counts = new Map<string, number>();
  for (const move of plan.moves) {
    const directory = move.toPath.includes("/")
      ? move.toPath.slice(0, move.toPath.lastIndexOf("/"))
      : ".";
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return {
    decisionId: stableId("klaydec", decisionHash),
    decisionHash,
    planId: plan.planId,
    recommendation: "accept",
    moveCount: plan.moves.length,
    userUpdateCount: plan.userUpdates.length,
    referenceUpdateCount: plan.referenceUpdates.length,
    destinations: [...counts]
      .map(([directory, count]) => ({ directory, count }))
      .sort(
        (left, right) => right.count - left.count || (left.directory < right.directory ? -1 : 1),
      )
      .slice(0, MAXIMUM_DESTINATIONS),
    deferredCount: plan.deferredDocumentCount,
  };
}

export function repositoryLayoutDecisionToken(decision: RepositoryLayoutDecision): string {
  return `${decision.decisionId}=${decision.decisionHash}`;
}

/**
 * Item approvals for an accepted decision token, or null when the token does not name this
 * plan's current decision. A stale token never grants a changed plan.
 */
export function repositoryLayoutDecisionApprovals(
  plan: DecisionPlan,
  token: string,
): Array<{ operationId: string; approvalHash: string }> | null {
  const match = TOKEN.exec(token);
  const decision = repositoryLayoutDecision(plan);
  if (match === null || decision === null) return null;
  return match[1] === decision.decisionId && match[2] === decision.decisionHash
    ? approvals(plan)
    : null;
}

export function validRepositoryLayoutDecisionToken(token: string): boolean {
  return TOKEN.test(token);
}

interface RepositoryLayoutDecisionState {
  schemaVersion: 1;
  declined: Array<{ decisionId: string; declinedAt: string }>;
}

async function readState(root: string): Promise<RepositoryLayoutDecisionState> {
  const empty: RepositoryLayoutDecisionState = { schemaVersion: 1, declined: [] };
  try {
    const path = resolve(root, repositoryLayoutDecisionStatePath);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size > MAXIMUM_STATE_BYTES) return empty;
    const value = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<RepositoryLayoutDecisionState>;
    return value.schemaVersion === 1 &&
      Array.isArray(value.declined) &&
      value.declined.every(
        (item) => typeof item?.decisionId === "string" && typeof item.declinedAt === "string",
      )
      ? (value as RepositoryLayoutDecisionState)
      : empty;
  } catch {
    return empty;
  }
}

/** True when the owner declined exactly this decision; a changed plan asks again. */
export async function repositoryLayoutDecisionDeclined(
  repositoryRoot: string,
  decisionId: string,
): Promise<boolean> {
  return (await readState(resolve(repositoryRoot))).declined.some(
    (item) => item.decisionId === decisionId,
  );
}

/** Records a decline for the current decision only; the newest 32 declines are kept. */
export async function declineRepositoryLayoutDecision(input: {
  repositoryRoot: string;
  plan: DecisionPlan;
  decisionId: string;
  now: Date;
}): Promise<RepositoryLayoutDecision> {
  const decision = repositoryLayoutDecision(input.plan);
  if (decision === null || decision.decisionId !== input.decisionId)
    throw new Error("The layout decision is not the current decision; rebuild the plan first.");
  const root = resolve(input.repositoryRoot);
  const state = await readState(root);
  if (!state.declined.some((item) => item.decisionId === decision.decisionId)) {
    state.declined = [
      ...state.declined,
      { decisionId: decision.decisionId, declinedAt: input.now.toISOString() },
    ].slice(-MAXIMUM_DECLINED);
    const path = resolve(root, repositoryLayoutDecisionStatePath);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return decision;
}
