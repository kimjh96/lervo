import {
  MAXIMUM_REPOSITORY_KNOWLEDGE_OUTSTANDING,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION,
  retireRepositoryKnowledgeJobs,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import type { ProjectStorage } from "@lervo/project-storage";

import { repositoryKnowledgeJobAdmission } from "./convergence-owner-fence.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import type { InstructionCandidateExchangeResult } from "./instruction-candidate-exchange.js";
import { listQueuedInstructionCaptures } from "./instruction-capture-queue.js";
import { recordMaintenanceObservation } from "./maintenance-observation.js";
import type { OwnerTurnCaptureWorkResult } from "./owner-turn-capture-work.js";
import { readPracticeState } from "./practice-store.js";
import {
  compactConvergenceWorkspaces,
  hasConvergenceWorkspaceRetention,
} from "./workspace-retention.js";

/** The reason a non-owner records instead of the owner's debt, which only the owner observes. */
export const WAITING_OWNER_REASON = "maintenance_owner_elsewhere";

/**
 * ADR-0597: the status a non-owner records. It carries no debt counts, because counting debt
 * needs a full repository observation that only the owner acts on; the record's owner fields
 * name the holder.
 */
export function waitingOwnerStatus(): KnowledgeConvergenceStatus {
  return {
    transport: "ready",
    debtCounts: null,
    outstanding: 0,
    oldestAgeMilliseconds: null,
    activeStage: null,
    state: "idle",
    reason: WAITING_OWNER_REASON,
    lastVerifiedCurrency: null,
  };
}

/** Candidate states the practice stage still acts on, as the practice schedule counts them. */
const ACTIVE_PRACTICE_CANDIDATE_STATES = new Set([
  "assessed",
  "unresolved",
  "drafted",
  "reviewed_accepted",
]);

/**
 * Whether this host has queued owner turns or practice work of its own (ADR-0467): unassessed
 * work, an active candidate, or a generated skill whose daily usage is assessed here.
 */
export async function nonOwnerCapturePending(root: string): Promise<boolean> {
  if ((await listQueuedInstructionCaptures(root).catch(() => [])).length > 0) return true;
  const practice = await readPracticeState(root);
  return (
    practice.works.length > 0 ||
    practice.generated.length > 0 ||
    practice.candidates.some((candidate) => ACTIVE_PRACTICE_CANDIDATE_STATES.has(candidate.state))
  );
}

export type NonOwnerCycleResult =
  | { status: "busy"; reason: "knowledge_cycle_yielded_to_upgrade" }
  | {
      status: "waiting_owner";
      owner: ConvergenceOwnerVerdict;
      convergence: KnowledgeConvergenceStatus;
      ownerTurns: OwnerTurnCaptureWorkResult | null;
    };

/**
 * ADR-0597 (amending ADR-0466, ADR-0467 and ADR-0518): a host that does not own convergence runs
 * only its host-local duties: its own queued owner turns and practice observation, the Hub
 * candidate exchange, and retirement of its own convergence checkouts. It never scans, lints or
 * records staleness or lifecycle, because the owner discards a non-owner's observation. ADR-0605:
 * it holds no repository knowledge job either; any it still has, from before it lost ownership or
 * from an earlier release, settle as `stale` (`convergence_owner_elsewhere`).
 */
export async function runNonOwnerCycle(input: {
  storage: ProjectStorage;
  owner: ConvergenceOwnerVerdict;
  captureOwnerTurns: () => Promise<OwnerTurnCaptureWorkResult>;
  observePractice: () => Promise<void>;
  /** The Hub exchange alone; absent when this host has no Hub transport. */
  exchangeCandidates?: () => Promise<InstructionCandidateExchangeResult>;
  upgradeWaiting: () => Promise<boolean>;
}): Promise<NonOwnerCycleResult> {
  const yielded = { status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" } as const;
  const root = input.storage.paths.repositoryRoot;
  if (await input.upgradeWaiting()) return yielded;
  const exchange = input.exchangeCandidates;
  const work = (await nonOwnerCapturePending(root))
    ? async () => {
        const captured = await input.captureOwnerTurns();
        await input.observePractice();
        return captured;
      }
    : exchange === undefined
      ? null
      : async (): Promise<OwnerTurnCaptureWorkResult> => ({
          instructionCapture: { status: "idle" },
          candidateExchange: await exchange().catch((): InstructionCandidateExchangeResult => ({
            status: "unavailable",
          })),
        });
  const ownerTurns = work === null ? null : await withRepositoryKnowledgeWorkerLock(root, work);
  if (await input.upgradeWaiting()) return yielded;
  // ADR-0605: the admission rule that keeps jobs off this host settles the ones it still holds.
  const admission = repositoryKnowledgeJobAdmission(input.owner);
  if (
    !admission.admitted &&
    input.storage.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION) +
      input.storage.events.outstandingCount(REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION) >
      0
  )
    await withRepositoryKnowledgeWorkerLock(root, async () =>
      retireRepositoryKnowledgeJobs({
        events: input.storage.events,
        workerId: `retire-${process.pid}`,
        reason: admission.reason,
        // The queue's own bound, so one cycle settles every job it can hold.
        maximumJobs: MAXIMUM_REPOSITORY_KNOWLEDGE_OUTSTANDING * 2,
      }),
    );
  // ADR-0518: convergence checkouts are host-local, so a non-owner still retires its own.
  if (await hasConvergenceWorkspaceRetention(input.storage))
    await withRepositoryKnowledgeWorkerLock(root, () =>
      compactConvergenceWorkspaces(input.storage),
    );
  const convergence = waitingOwnerStatus();
  await recordMaintenanceObservation({
    root,
    projectId: input.storage.manifest.projectId,
    status: convergence,
    owner: input.owner,
    source: "inspection",
  });
  return {
    status: "waiting_owner",
    owner: input.owner,
    convergence,
    ownerTurns: ownerTurns === null || ownerTurns.status === "busy" ? null : ownerTurns.result,
  };
}
