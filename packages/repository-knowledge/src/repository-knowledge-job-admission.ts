import type { OutboxStore } from "@lervo/storage-contract";

import {
  claimRepositoryKnowledgeJob,
  emptyRepositoryKnowledgeIntakeSummary,
} from "./repository-knowledge-worker.js";
import { TerminalOutcome } from "./repository-knowledge-worker-contract.js";
import { settleRepositoryKnowledgeJob } from "./repository-knowledge-settlement.js";

/**
 * ADR-0605: whether this host may hold repository knowledge jobs. Only the host that runs them
 * holds them: a host whose convergence another host owns never runs its queue, so it never
 * receives a job. The change event itself is always recorded; it is canonical, and the owner of
 * record later finds a change without a settled job as convergence debt.
 */
export type RepositoryKnowledgeJobAdmission =
  | { admitted: true }
  | { admitted: false; reason: "convergence_owner_elsewhere" | "convergence_owner_ineligible" };

/** A short lease: retirement settles each job at once and never runs it. */
const RETIREMENT_LEASE_MS = 60_000;

/**
 * ADR-0605: settles queued jobs a host is not admitted to hold, each as one auditable
 * `repository.knowledge.resolved` event in state `stale` with `reason` as its failure code, which
 * the requeue never puts back. The same admission rule that keeps such jobs from being enqueued
 * decides this, so a queue a host may not hold drains as soon as it holds none.
 */
export function retireRepositoryKnowledgeJobs(input: {
  events: OutboxStore;
  workerId: string;
  reason: string;
  now?: () => Date;
  maximumJobs?: number;
}): number {
  const now = input.now ?? (() => new Date());
  let retired = 0;
  for (; retired < (input.maximumJobs ?? 64); retired++) {
    const delivery = claimRepositoryKnowledgeJob(
      input.events,
      input.workerId,
      now().toISOString(),
      RETIREMENT_LEASE_MS,
    );
    if (delivery === undefined) break;
    settleRepositoryKnowledgeJob({
      events: input.events,
      delivery,
      workerId: input.workerId,
      outcome: new TerminalOutcome("stale", input.reason),
      intake: emptyRepositoryKnowledgeIntakeSummary(),
      resolvedAt: now().toISOString(),
    });
  }
  return retired;
}
