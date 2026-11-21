import {
  repositoryUpgradeFailureDetail,
  type RepositoryUpgradeFailureDetail,
} from "./host-follow-failure-detail.js";
import { execFile } from "node:child_process";

/**
 * ADR-0575: one `lervo upgrade` invocation, translated from the command's JSON output. `failed`
 * carries the command's own error code; `unreadable` means it exited without a JSON result,
 * `timed_out` that the runner stopped it at its bound, and `interrupted` that a signal it did not
 * send ended it (a service stop, logout, shutdown, or the kernel's OOM killer), which says
 * nothing about the release.
 */
export type RepositoryUpgradeInvocation =
  | {
      kind: "result";
      status: string;
      /** A plan's id, or a receipt's `nextPlanId`. */
      planId: string | null;
      applicableStages: string[];
      appliedStages: string[];
      pendingStages: string[];
      timing: { admissionWaitMs: number; applyMs: number } | null;
      /** ADR-0579: the receipt's consecutive apply parts; absent for a plan or an earlier CLI. */
      stageTimings?: Array<{ stage: string; ms: number }>;
      /** ADR-0561: a plan's stages Lervo holds as its own debt; absent for a receipt. */
      lervoDebtStages?: string[];
    }
  | { kind: "failed"; code: string; failure?: RepositoryUpgradeFailureDetail }
  | { kind: "unreadable" }
  | { kind: "timed_out" }
  | { kind: "interrupted" };

/**
 * Runs `lervo` with the given arguments, for example `upgrade --root <path> --json`. Aborting
 * `signal` stops the running command, which then reports `interrupted`.
 */
export type RepositoryUpgradeRunner = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<RepositoryUpgradeInvocation>;

/** An upgrade can wait 15 minutes for admission and apply for longer; this bounds a hung run. */
const upgradeTimeoutMilliseconds = 90 * 60_000;
const maximumOutputBytes = 32 * 1024 * 1024;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** A receipt names a few dozen parts; a longer list is not one this CLI wrote. */
const maximumStageTimings = 64;

function stageTimings(value: unknown): Array<{ stage: string; ms: number }> {
  if (!Array.isArray(value) || value.length > maximumStageTimings) return [];
  return value.flatMap((item: unknown) => {
    const { stage, ms } = (item ?? {}) as { stage?: unknown; ms?: unknown };
    return typeof stage === "string" && typeof ms === "number" && Number.isFinite(ms) && ms >= 0
      ? [{ stage, ms }]
      : [];
  });
}

/** The stages a plan holds as Lervo debt, named as a receipt names them (ADR-0561). */
function lervoDebtStages(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([stage, plan]) =>
    stage !== "runtimeRetention" &&
    (plan as { disposition?: unknown } | null)?.disposition === "lervo_debt"
      ? [stage.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)]
      : [],
  );
}

export function parseRepositoryUpgradeOutput(stdout: string): RepositoryUpgradeInvocation {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return { kind: "unreadable" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { kind: "unreadable" };
  const record = value as Record<string, unknown>;
  if (record.status === "failed") {
    const error = (
      record.error !== null && typeof record.error === "object" ? record.error : {}
    ) as Record<string, unknown>;
    const failure = repositoryUpgradeFailureDetail(error);
    return {
      kind: "failed",
      code: typeof error.code === "string" ? error.code : "command_failed",
      ...(failure === undefined ? {} : { failure }),
    };
  }
  if (typeof record.status !== "string") return { kind: "unreadable" };
  const pending = Array.isArray(record.pending) ? record.pending : [];
  const timing = record.timing as { admissionWaitMs?: unknown; applyMs?: unknown } | undefined;
  const parts = stageTimings(record.stageTimings);
  return {
    kind: "result",
    status: record.status,
    planId:
      typeof record.planId === "string"
        ? record.planId
        : typeof record.nextPlanId === "string"
          ? record.nextPlanId
          : null,
    timing:
      typeof timing?.admissionWaitMs === "number" && typeof timing.applyMs === "number"
        ? { admissionWaitMs: timing.admissionWaitMs, applyMs: timing.applyMs }
        : null,
    applicableStages: strings(record.applicableStages),
    appliedStages: strings(record.appliedStages),
    pendingStages: pending.flatMap((item: unknown) => {
      const stage = (item as { stage?: unknown } | null)?.stage;
      return typeof stage === "string" ? [stage] : [];
    }),
    ...(parts.length === 0 ? {} : { stageTimings: parts }),
    ...(record.planKind === "repository_upgrade"
      ? { lervoDebtStages: lervoDebtStages(record.stages) }
      : {}),
  };
}

/**
 * Runs the active CLI through its `lervo` link, as the owner's shell would, so a pass always
 * exercises the CLI that is active now, whichever version the follower process itself runs.
 */
export function createLinkedCliUpgradeRunner(
  executable: string,
  environment: NodeJS.ProcessEnv,
): RepositoryUpgradeRunner {
  return (args, signal) =>
    new Promise((resolvePromise) => {
      execFile(
        executable,
        [...args],
        {
          env: environment,
          encoding: "utf8",
          maxBuffer: maximumOutputBytes,
          timeout: upgradeTimeoutMilliseconds,
          killSignal: "SIGTERM",
          ...(signal === undefined ? {} : { signal }),
        },
        (error, stdout) => {
          const failure = error as
            (NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }) | null;
          if (signal?.aborted === true || failure?.name === "AbortError") {
            resolvePromise({ kind: "interrupted" });
            return;
          }
          // The runner's own timeout sets `killed`; any other signal came from outside.
          if (failure?.killed === true) {
            resolvePromise({ kind: "timed_out" });
            return;
          }
          if (typeof failure?.signal === "string") {
            resolvePromise({ kind: "interrupted" });
            return;
          }
          // A blocked plan exits 1 with a JSON result; only the output decides.
          resolvePromise(parseRepositoryUpgradeOutput(stdout ?? ""));
        },
      );
    });
}
