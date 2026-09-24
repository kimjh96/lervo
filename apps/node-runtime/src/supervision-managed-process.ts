import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import type { EventStore } from "@lervo/storage-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import type { SupervisedManagedInvocation } from "./supervision-managed-admission.js";
import { observedSupervisionRunTermination } from "./supervision-run-termination.js";

export interface SupervisedManagedProcessConfiguration {
  nodeExecutable: string;
  cliBundle: string;
  providerExecutable: string;
  environment: Readonly<Record<string, string>>;
}

export type SupervisedManagedProcessFailureCode =
  | "managed_launch_failed"
  | "managed_process_failed"
  | "managed_output_bound_exceeded"
  | "managed_revalidation_failed"
  | "managed_deadline_elapsed"
  | "managed_cancelled"
  | "managed_stdin_failed"
  | "managed_dispatch_evidence_missing"
  | "managed_outcome_unreconciled";

/** Carries only a bounded failure code; child output, paths, and provider errors stay out. */
export class SupervisedManagedProcessError extends Error {
  constructor(
    readonly code: SupervisedManagedProcessFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "SupervisedManagedProcessError";
  }
}

/** Runs the managed CLI boundary. Process exit alone never proves dispatch or acceptance. */
export async function runSupervisedManagedProcess(input: {
  repositoryRoot: string;
  invocation: SupervisedManagedInvocation;
  configuration: SupervisedManagedProcessConfiguration;
  events: EventStore;
  fence: { commit<T>(effect: () => T): T; renew(): void };
  now(): string;
  revalidate(): Promise<void>;
  signal?: AbortSignal;
}): Promise<{ eventIds: string[] }> {
  const invocation = structuredClone(input.invocation);
  const configuration = structuredClone(input.configuration);
  for (const path of [
    input.repositoryRoot,
    configuration.nodeExecutable,
    configuration.cliBundle,
    configuration.providerExecutable,
  ])
    if (!isAbsolute(path) || path.includes("\0"))
      throw new Error("The managed process path is invalid.");
  const identity = managedExecutionIdentity(
    invocation.plan.projectId,
    operatingContractHash(invocation.plan),
  );
  const timeout = Date.parse(invocation.plan.deadline) - Date.parse(input.now());
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86_400_000 || input.signal?.aborted)
    throw new Error("The managed process deadline is unavailable.");
  const body = JSON.stringify({ invocation, providerExecutable: configuration.providerExecutable });
  if (Buffer.byteLength(body) > 256 * 1024) throw new Error("The managed invocation is too large.");
  let monitor: Promise<void> = Promise.resolve();
  let stderrTail = Buffer.alloc(0);
  try {
    await new Promise<void>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = input.fence.commit(() =>
          spawn(
            configuration.nodeExecutable,
            [configuration.cliBundle, "run", "--supervised-stdin", "--json"],
            {
              cwd: input.repositoryRoot,
              env: configuration.environment,
              shell: false,
              windowsHide: true,
              stdio: ["pipe", "pipe", "pipe"],
            },
          ),
        );
      } catch {
        reject(
          new SupervisedManagedProcessError(
            "managed_launch_failed",
            "The managed worker could not be launched.",
          ),
        );
        return;
      }
      let interrupted: SupervisedManagedProcessFailureCode | null = null;
      let settled = false;
      let bytes = 0;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const abort = (code: SupervisedManagedProcessFailureCode) => {
        if (interrupted !== null || settled) return;
        interrupted = code;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      };
      const deadline = setTimeout(() => abort("managed_deadline_elapsed"), timeout);
      let checking = false;
      const renewal = setInterval(() => {
        if (checking || settled) return;
        checking = true;
        monitor = Promise.resolve()
          .then(() => revalidateWithinAuthorityWindow(input.revalidate))
          .then(() => {
            if (!settled && interrupted === null) input.fence.renew();
          })
          .catch(() => abort("managed_revalidation_failed"))
          .finally(() => {
            checking = false;
          });
      }, 60_000);
      const cancel = () => abort("managed_cancelled");
      input.signal?.addEventListener("abort", cancel, { once: true });
      const cleanup = () => {
        settled = true;
        clearTimeout(deadline);
        clearInterval(renewal);
        if (killTimer !== undefined) clearTimeout(killTimer);
        input.signal?.removeEventListener("abort", cancel);
      };
      const collect = (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 1024 * 1024) abort("managed_output_bound_exceeded");
      };
      child.stdout!.on("data", collect);
      child.stderr!.on("data", (chunk: Buffer) => {
        collect(chunk);
        stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-4096);
      });
      child.stdin!.on("error", () => abort("managed_stdin_failed"));
      child.once("error", () => {
        cleanup();
        reject(
          new SupervisedManagedProcessError(
            "managed_process_failed",
            "The managed worker process failed.",
          ),
        );
      });
      child.once("close", () => {
        cleanup();
        if (interrupted !== null)
          reject(
            new SupervisedManagedProcessError(
              interrupted,
              "The managed worker outcome requires reconciliation.",
            ),
          );
        else resolve();
      });
      child.stdin!.end(body);
      if (input.signal?.aborted) cancel();
    });
  } finally {
    await monitor;
  }
  const events = collectRunEventsBounded({
    events: input.events,
    runId: identity.runId,
    maximumEvents: 4096,
  });
  const reserved = events.find((event) => event.type === "managed.execution.reserved");
  const requested = events.find((event) => event.type === "run.requested");
  const cause = events.find((event) => event.type === "work.causality.recorded");
  if (
    reserved === undefined ||
    requested === undefined ||
    cause?.payload.assignmentId !== invocation.effect.responsibility.assignmentId ||
    reserved.payload.executionKey !== operatingContractHash(invocation.plan)
  )
    throw new SupervisedManagedProcessError(
      "managed_dispatch_evidence_missing",
      `The managed worker has no exact canonical dispatch evidence${workerFailureSuffix(stderrTail)}.`,
    );
  if (observedSupervisionRunTermination(events) === null)
    throw new SupervisedManagedProcessError(
      "managed_outcome_unreconciled",
      "The managed worker outcome requires reconciliation.",
    );
  return { eventIds: [reserved.eventId, requested.eventId] };
}

/** An unavailable authority read must not hold cancellation or the serial owner indefinitely. */
async function revalidateWithinAuthorityWindow(revalidate: () => Promise<void>): Promise<void> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(revalidate),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () => reject(new Error("The managed process authority observation expired.")),
          5000,
        );
      }),
    ]);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
}

/** The worker CLI's last bounded failure line, for host diagnostics only. */
export function workerFailureSuffix(stderrTail: Buffer): string {
  const line = stderrTail.toString("utf8").trim().split("\n").at(-1) ?? "";
  try {
    const failure = JSON.parse(line) as { reason?: unknown; message?: unknown };
    if (typeof failure.reason !== "string" || typeof failure.message !== "string") return "";
    return ` (worker ${failure.reason.slice(0, 64)}: ${failure.message.replace(/[\r\n\0]+/gu, " ").slice(0, 200)})`;
  } catch {
    return "";
  }
}
