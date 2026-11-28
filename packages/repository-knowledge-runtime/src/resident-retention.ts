// ADR-0660: when the resident's next retention-only slice is due. Retention with work left is the
// only thing this wakes for, and it runs only the retention slice; every other stage still waits
// for a fingerprint change or a reconcile deadline.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CAS_RETENTION_OBSERVATION } from "./cas-retention-files.js";
import {
  CAS_RETENTION_HOST_PAUSE_MILLISECONDS as PAUSE,
  CAS_RETENTION_TURN_GRACE_MILLISECONDS as GRACE,
} from "./cas-retention-host-turns.js";
import {
  readRetentionWait,
  recordRetentionWait,
  type CasRetentionWaitCause,
} from "./cas-retention-wait.js";
import { foregroundWorkPending } from "./foreground-admission.js";
import { fullCycleAdmissionDirectory } from "./full-cycle-admission.js";
import type { AutonomousKnowledgeWorkerInput } from "./loop-options.js";
import { runRetentionOnlySlice, type RetentionOnlyOutcome } from "./retention-only-slice.js";

/** While live work or full cycles hold, the wait between attempts doubles up to this ceiling. */
export const RETENTION_BACKOFF_CEILING_MILLISECONDS = 10 * 60_000;
/** An observation older than this arms nothing; the next full cycle's pass looks afresh. */
const OBSERVATION_STALE_MILLISECONDS = 24 * 60 * 60_000;
const MINIMUM_DELAY_MILLISECONDS = 1_000;

export interface RetentionWake {
  /** Null waits for a full cycle. */
  at: number | null;
  backoff: number;
  /** Why no slice ran, null once one ran, undefined to leave the record as it is. */
  wait?: CasRetentionWaitCause | null;
}

/**
 * The next retention-only wake after `outcome`. A held or off-base checkout takes no effect, and
 * a finished store has nothing left. A denied turn comes back exactly when told, which is what
 * keeps its place; live work and busy full cycles back off.
 */
export function nextRetentionWake(
  outcome: RetentionOnlyOutcome,
  backoff: number,
  now: number,
): RetentionWake {
  const backedOff = Math.min(backoff * 2, RETENTION_BACKOFF_CEILING_MILLISECONDS);
  const backOff = (wait: CasRetentionWaitCause): RetentionWake => ({
    at: now + backedOff,
    backoff: backedOff,
    wait,
  });
  const turn = (retryAt: number | null): RetentionWake => ({
    at: Math.max(retryAt ?? now + PAUSE, now + MINIMUM_DELAY_MILLISECONDS),
    backoff,
    wait: "retention_turn",
  });
  switch (outcome.kind) {
    case "held":
    case "off_base":
      return { at: null, backoff };
    case "live_work":
      return backOff("live_work");
    case "admission_busy":
      return backOff("admission_busy");
    case "turn_deferred":
      return turn(outcome.retryAt);
  }
  const { slice } = outcome;
  // A pass that yielded at entry, to live work or a materialization, did no work.
  if (slice.outcome === "entry_yield") return backOff("live_work");
  if (slice.outcome === "busy") return { at: now + PAUSE, backoff };
  if (slice.outcome === "deferred") return turn(slice.retryAt);
  return {
    at: slice.observation?.remaining === true ? now + PAUSE : null,
    backoff: PAUSE,
    wait: null,
  };
}

/**
 * After a full cycle: when retention is due again. A turn the cycle's own retention was denied
 * names its moment, and the request holds its place only if the resident comes back then.
 * Otherwise the next slice follows while the last recorded pass left work; a failed pass, an
 * observation older than a day, or an unreadable one arms nothing.
 */
export function retentionPendingAfterCycle(repositoryRoot: string, now: number): number | null {
  const wait = readRetentionWait(resolve(repositoryRoot, ".lervo/state/knowledge"));
  if (wait?.cause === "retention_turn" && wait.retryAt !== undefined && wait.retryAt >= now - GRACE)
    return wait.retryAt;
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
  afterCycle(): Promise<void>;
  settled(): Promise<void>;
}

export function residentRetention(input: {
  runSlice: () => Promise<RetentionOnlyOutcome>;
  /** After a full cycle: when retention is due again, or null when no work is left. */
  pendingAfterCycle: (now: number) => Promise<number | null>;
  liveWorkPending: () => Promise<boolean>;
  cycleRunning: () => boolean;
  arm: (at: number | null) => void;
  recordWait: (cause: CasRetentionWaitCause | null, now: number, retryAt?: number) => Promise<void>;
  stopped: () => boolean;
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
      if (input.stopped()) return;
      input.onFailure(error);
      outcome = { kind: "live_work" };
    }
    const next = nextRetentionWake(outcome, backoff, now());
    backoff = next.backoff;
    // A lost record costs only attention's detail, never the next slice.
    if (next.wait !== undefined)
      await input
        .recordWait(
          next.wait,
          now(),
          next.wait === "retention_turn" ? (next.at ?? undefined) : undefined,
        )
        .catch(() => undefined);
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
    async afterCycle() {
      const at = await input.pendingAfterCycle(now()).catch(() => null);
      // While live work holds, the backoff stands; a full cycle does not reset it.
      const live = at !== null && (await input.liveWorkPending().catch(() => false));
      if (!input.stopped())
        input.arm(at === null ? null : Math.max(at, now() + (live ? backoff : 0)));
    },
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
  const directory = fullCycleAdmissionDirectory(input.admissionDirectory);
  const liveWorkPending = foregroundWorkPending(root);
  return residentRetention({
    runSlice: () =>
      runRetentionOnlySlice({
        storage: input.storage,
        admissionDirectory: directory,
        signal: wiring.signal,
        liveWorkPending,
      }),
    pendingAfterCycle: async (now) => retentionPendingAfterCycle(root, now),
    liveWorkPending,
    cycleRunning: wiring.cycleRunning,
    arm: wiring.arm,
    recordWait: (cause, now, retryAt) =>
      recordRetentionWait(input.storage.paths.knowledgeState, cause, now, retryAt),
    stopped: () => wiring.signal.aborted,
    onFailure: input.onFailure,
  });
}
