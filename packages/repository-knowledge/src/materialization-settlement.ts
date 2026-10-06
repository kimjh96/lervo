import {
  describeKnowledgeMaterializationOwner,
  knowledgeMaterializationMarkerError,
  liveKnowledgeMaterializationLabel,
  type LiveKnowledgeMaterializationOwner,
} from "./materialization-owner.js";
import { RepositoryKnowledgeError } from "./types.js";

/** How long one foreground command waits, in total, for live materialization owners to settle. */
export const KNOWLEDGE_MATERIALIZATION_SETTLE_WAIT_MS = 15 * 60_000;
export const KNOWLEDGE_MATERIALIZATION_SETTLE_POLL_MS = 2_000;
/** Bounds re-runs when markers keep appearing between a settled observation and the operation. */
const MAXIMUM_OPERATION_ATTEMPTS = 32;

export interface KnowledgeMaterializationSettlementOptions {
  repositoryRoot: string;
  waitMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (durationMs: number) => Promise<void>;
  /** Called once per live owner the settlement starts waiting for. */
  onWait?: (owner: LiveKnowledgeMaterializationOwner, remainingMs: number) => void;
}

export interface KnowledgeMaterializationSettlement {
  /** Waits while a live owner holds the marker and returns what remains; it never changes a marker. */
  settle(): Promise<"none" | "interrupted">;
  /**
   * Runs a marker-guarded operation once no live owner holds the marker. An interrupted marker
   * refuses immediately with the recovery command. When a new live owner refuses the operation,
   * by error or by a value `refusedByMarker` recognizes, the settlement waits and runs it again.
   * Only operations that check the marker before any effect may be run here.
   */
  run<T>(operation: () => Promise<T>, refusedByMarker?: (value: T) => boolean): Promise<T>;
}

function markerRefusal(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "knowledge_recovery_required";
}

/**
 * One bounded wait budget shared by every marker check of a foreground command. A live owner
 * settles on its own, so waiting replaces failing at the first collision with background work.
 */
export function createKnowledgeMaterializationSettlement(
  options: KnowledgeMaterializationSettlementOptions,
): KnowledgeMaterializationSettlement {
  const waitMs = options.waitMs ?? KNOWLEDGE_MATERIALIZATION_SETTLE_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? KNOWLEDGE_MATERIALIZATION_SETTLE_POLL_MS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((durationMs: number) => new Promise<void>((done) => setTimeout(done, durationMs)));
  let deadline: number | undefined;
  let announcedPlanId: string | undefined;

  async function settle(): Promise<"none" | "interrupted"> {
    for (;;) {
      const owner = await describeKnowledgeMaterializationOwner(options);
      if (owner.state !== "live") return owner.state;
      const current = now();
      deadline ??= current + waitMs;
      if (current >= deadline)
        throw new RepositoryKnowledgeError(
          "knowledge_materialization_wait_expired",
          `The live knowledge materialization owned by ${liveKnowledgeMaterializationLabel(owner)} did not settle within ${Math.round(waitMs / 60_000)} minutes. Its transaction was left untouched; retry after it settles.`,
        );
      if (announcedPlanId !== owner.planId) {
        announcedPlanId = owner.planId;
        options.onWait?.(owner, deadline - current);
      }
      await sleep(Math.min(pollIntervalMs, deadline - current));
    }
  }

  async function run<T>(
    operation: () => Promise<T>,
    refusedByMarker?: (value: T) => boolean,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      if ((await settle()) === "interrupted")
        throw knowledgeMaterializationMarkerError({ state: "interrupted" });
      let value: T;
      try {
        value = await operation();
      } catch (error) {
        if (markerRefusal(error) && attempt < MAXIMUM_OPERATION_ATTEMPTS) continue;
        throw error;
      }
      if (refusedByMarker?.(value) !== true || attempt >= MAXIMUM_OPERATION_ATTEMPTS) return value;
    }
  }

  return { settle, run };
}
