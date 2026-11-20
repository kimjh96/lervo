import type { ProjectStorage } from "@lervo/project-storage";
import type { ProcessCostMeasurement } from "@lervo/repository-knowledge";

import type { ConvergenceContinuity } from "./convergence-continuity.js";
import type { ConvergenceOwnership } from "./convergence-owner.js";
import type { KnowledgeHubChangeTransport } from "./hub-knowledge-changes.js";
import type { InstructionCandidateExchangeTransport } from "./instruction-candidate-exchange.js";
import type { KnowledgePublicationOutcome } from "./knowledge-publication.js";
import type { KnowledgePublicationRepairEvents } from "./knowledge-publication-repair.js";
import type { runAutonomousKnowledgeWorker } from "./worker.js";

export type AutonomousKnowledgeWorkerResult = Awaited<
  ReturnType<typeof runAutonomousKnowledgeWorker>
>;

/** What a resident is composed from; see startAutonomousKnowledgeWorker. */
export interface AutonomousKnowledgeWorkerInput {
  storage: ProjectStorage;
  signal?: AbortSignal;
  workerId: string;
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  /** ADR-0602: defaults to event and repository wakeups, so every host sees an edit at once. */
  subscribe?: (notify: () => void, lastVerdictIsOwner: () => boolean) => () => void;
  /** Coalesces a burst of wakeups (ADR-0461): 30 s after the last, 60 s after the first. */
  wakeDebounceMilliseconds?: number;
  /** `cost` covers the fence observation and the full cycle, attributed by scope. */
  onCycle?: (result: AutonomousKnowledgeWorkerResult, cost: ProcessCostMeasurement) => void;
  /**
   * Read-only projections, offered after every observation (including skipped and failed cycles)
   * and on their own check cadence, so a long cycle never leaves the projection older than its
   * display window. ADR-0595: an offer refreshes only when the projection's inputs changed, or
   * after the maximum age while nothing changed; a held repository has no age refresh.
   */
  refreshHealth?: () => Promise<void>;
  projectionMaximumAgeMilliseconds?: number;
  onFailure: (error: unknown) => void;
  intervalMilliseconds?: number;
  reconcileCeilingMilliseconds?: number;
  /** ADR-0466 cross-host owner; absent keeps the legacy single-host resident. */
  ownership?: ConvergenceOwnership;
  ownerHeartbeatMilliseconds?: number;
  /**
   * Publishes the owner's settled commits after each cycle; absent disables publication. The
   * resident's event store receives `knowledge.publication.repaired` (ADR-0473).
   */
  publish?: (context: {
    events: KnowledgePublicationRepairEvents;
  }) => Promise<KnowledgePublicationOutcome>;
  /** ADR-0467 Hub adapter for owner-rule candidates; absent keeps them host-local. */
  instructionCandidateTransport?: InstructionCandidateExchangeTransport;
  /** ADR-0545 owner-stated rule application on the convergence owner; absent keeps candidates. */
  applyOwnerStatedInstructions?: () => Promise<unknown>;
  /** ADR-0469 delegation and host continuity; it runs before each ownership observation. */
  continuity?: ConvergenceContinuity;
  /** ADR-0602 Hub `knowledge` change waits; absent keeps the resident on local signals only. */
  hubChanges?: KnowledgeHubChangeTransport;
}
