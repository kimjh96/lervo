// ADR-0660: when the resident's next retention-only slice is due. Retention with work left is the
// only thing this wakes for, and it runs only the retention slice; every other stage still waits
// for a fingerprint change or a reconcile deadline.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CAS_RETENTION_OBSERVATION } from "./cas-retention-files.js";
import { CAS_RETENTION_HOST_PAUSE_MILLISECONDS as PAUSE } from "./cas-retention-host-turns.js";
import { foregroundWorkPending } from "./foreground-admission.js";
import type { AutonomousKnowledgeWorkerInput } from "./loop-options.js";
import { runRetentionOnlySlice, type RetentionOnlyOutcome } from "./retention-only-slice.js";

/** While live work holds, the wait between attempts doubles up to this ceiling. */
export const RETENTION_BACKOFF_CEILING_MILLISECONDS = 10 * 60_000;
/** An observation older than this arms nothing; the next full cycle's pass looks afresh. */
const OBSERVATION_STALE_MILLISECONDS = 24 * 60 * 60_000;
const MINIMUM_DELAY_MILLISECONDS = 1_000;

/**
 * The next retention-only wake after `outcome`, and the backoff to carry. Null waits for a full
 * cycle: a held or off-base checkout takes no effect, and a finished store has nothing left.
 */
export function nextRetentionWake(
  outcome: RetentionOnlyOutcome,
  backoff: number,
  now: number,
): { at: number | null; backoff: number } {
  const backedOff = Math.min(backoff * 2, RETENTION_BACKOFF_CEILING_MILLISECONDS);
  if (outcome.kind !== "slice") {
    if (outcome.kind === "live_work") return { at: now + backedOff, backoff: backedOff };
    return { at: outcome.kind === "admission_busy" ? now + PAUSE : null, backoff };
  }
  const { slice } = outcome;
  // A pass that yielded at entry, to live work or a materialization, did no work: it backs off.
  if (slice.outcome === "entry_yield") return { at: now + backedOff, backoff: backedOff };
  if (slice.outcome === "busy") return { at: now + PAUSE, backoff };
  if (slice.outcome === "deferred")
    return {
      at: Math.max(slice.retryAt ?? now + PAUSE, now + MINIMUM_DELAY_MILLISECONDS),
      backoff,
    };
  return { at: slice.observation?.remaining === true ? now + PAUSE : null, backoff: PAUSE };
}

/**
 * After a full cycle: the next slice while the last recorded pass left work. A failed pass, an
 * observation older than a day, or an unreadable one arms nothing.
 */
export function retentionPendingAfterCycle(repositoryRoot: string, now: number): number | null {
  try {
    const observation = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, ".lervo/state/knowledge", CAS_RETENTION_OBSERVATION),
        "utf8",
      ),
    ) as { observedAt?: unknown; status?: unknown; remaining?: unknown };
    const observedAt = Date.parse(String(observation.observedAt));
    if (
      observation.remaining !== true ||
      observation.status === "unavailable" ||
      !(now - observedAt < OBSERVATION_STALE_MILLISECONDS)
    )
      return null;
    return now + PAUSE;
  } catch {
    return null;
  }
}

export interface ResidentRetention {
  /** One retention-only slice, unless a full cycle runs; that cycle re-arms when it ends. */
  run(): Promise<void>;
  afterCycle(): void;
  settled(): Promise<void>;
}

export function residentRetention(input: {
  runSlice: () => Promise<RetentionOnlyOutcome>;
  pendingAfterCycle: (now: number) => number | null;
  cycleRunning: () => boolean;
  arm: (at: number | null) => void;
  onFailure: (error: unknown) => void;
  now?: () => number;
}): ResidentRetention {
  const now = input.now ?? Date.now;
  let backoff = PAUSE;
  let running: Promise<void> | null = null;
  const slice = async () => {
    let outcome: RetentionOnlyOutcome;
    try {
      outcome = await input.runSlice();
    } catch (error) {
      input.onFailure(error);
      outcome = { kind: "live_work" };
    }
    const next = nextRetentionWake(outcome, backoff, now());
    backoff = next.backoff;
    if (!input.cycleRunning()) input.arm(next.at);
  };
  return {
    run() {
      if (running === null && !input.cycleRunning())
        running = slice().finally(() => {
          running = null;
        });
      return running ?? Promise.resolve();
    },
    afterCycle: () => input.arm(input.pendingAfterCycle(now())),
    settled: () => running ?? Promise.resolve(),
  };
}

/** The resident's composition: its own live-work probe, admission directory and signal. */
export function startResidentRetention(
  input: AutonomousKnowledgeWorkerInput,
  wiring: Pick<Parameters<typeof residentRetention>[0], "cycleRunning" | "arm"> & {
    signal: AbortSignal;
  },
): ResidentRetention {
  const root = input.storage.paths.repositoryRoot;
  return residentRetention({
    runSlice: () =>
      runRetentionOnlySlice({
        storage: input.storage,
        ...(input.admissionDirectory === undefined
          ? {}
          : { admissionDirectory: input.admissionDirectory }),
        signal: wiring.signal,
        liveWorkPending: foregroundWorkPending(root),
      }),
    pendingAfterCycle: (now) => retentionPendingAfterCycle(root, now),
    cycleRunning: wiring.cycleRunning,
    arm: wiring.arm,
    onFailure: input.onFailure,
  });
}
