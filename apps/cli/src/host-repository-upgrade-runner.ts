import { execFile } from "node:child_process";

/**
 * ADR-0575: one `lervo upgrade` invocation, translated from the command's JSON output. `failed`
 * carries the command's own error code; `unreadable` means it printed no JSON result at all, and
 * `timed_out` that it was stopped at the bound.
 */
export type RepositoryUpgradeInvocation =
  | {
      kind: "result";
      status: string;
      planId: string | null;
      applicableStages: string[];
      appliedStages: string[];
      pendingStages: string[];
    }
  | { kind: "failed"; code: string }
  | { kind: "unreadable" }
  | { kind: "timed_out" };

/** Runs `lervo` with the given arguments, for example `upgrade --root <path> --json`. */
export type RepositoryUpgradeRunner = (
  args: readonly string[],
) => Promise<RepositoryUpgradeInvocation>;

/** An upgrade can wait 15 minutes for admission and apply for longer; this bounds a hung run. */
const upgradeTimeoutMilliseconds = 90 * 60_000;
const maximumOutputBytes = 32 * 1024 * 1024;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

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
  const error = record.error as { code?: unknown } | undefined;
  if (record.status === "failed")
    return {
      kind: "failed",
      code: typeof error?.code === "string" ? error.code : "command_failed",
    };
  if (typeof record.status !== "string") return { kind: "unreadable" };
  const pending = Array.isArray(record.pending) ? record.pending : [];
  return {
    kind: "result",
    status: record.status,
    planId: typeof record.planId === "string" ? record.planId : null,
    applicableStages: strings(record.applicableStages),
    appliedStages: strings(record.appliedStages),
    pendingStages: pending.flatMap((item: unknown) => {
      const stage = (item as { stage?: unknown } | null)?.stage;
      return typeof stage === "string" ? [stage] : [];
    }),
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
  return (args) =>
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
        },
        (error, stdout) => {
          const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          if (failure?.killed === true) {
            resolvePromise({ kind: "timed_out" });
            return;
          }
          // A blocked plan exits 1 with a JSON result; only the output decides.
          resolvePromise(parseRepositoryUpgradeOutput(stdout ?? ""));
        },
      );
    });
}
