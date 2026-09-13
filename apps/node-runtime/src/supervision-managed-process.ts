import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import type { EventStore } from "@lervo/storage-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import type { SupervisedManagedInvocation } from "./supervision-managed-admission.js";

export interface SupervisedManagedProcessConfiguration {
  nodeExecutable: string;
  cliBundle: string;
  providerExecutable: string;
  environment: Readonly<Record<string, string>>;
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
        reject(new Error("The managed worker could not be launched."));
        return;
      }
      let interrupted = false;
      let settled = false;
      let bytes = 0;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => {
        if (interrupted || settled) return;
        interrupted = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      };
      const deadline = setTimeout(abort, timeout);
      let checking = false;
      const renewal = setInterval(() => {
        if (checking || settled) return;
        checking = true;
        monitor = Promise.resolve()
          .then(() => revalidateWithinAuthorityWindow(input.revalidate))
          .then(() => {
            if (!settled && !interrupted) input.fence.renew();
          })
          .catch(abort)
          .finally(() => {
            checking = false;
          });
      }, 60_000);
      input.signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        settled = true;
        clearTimeout(deadline);
        clearInterval(renewal);
        if (killTimer !== undefined) clearTimeout(killTimer);
        input.signal?.removeEventListener("abort", abort);
      };
      const collect = (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 1024 * 1024) abort();
      };
      child.stdout!.on("data", collect);
      child.stderr!.on("data", collect);
      child.stdin!.on("error", () => abort());
      child.once("error", () => {
        cleanup();
        reject(new Error("The managed worker process failed."));
      });
      child.once("close", () => {
        cleanup();
        if (interrupted) reject(new Error("The managed worker outcome requires reconciliation."));
        else resolve();
      });
      child.stdin!.end(body);
      if (input.signal?.aborted) abort();
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
    throw new Error("The managed worker has no exact canonical dispatch evidence.");
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
