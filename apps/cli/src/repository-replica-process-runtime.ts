import type { ProcessObservation } from "@lervo/node-work-admission";

import { findRuntimeProcessBinding } from "./node-runtime-process-binding.js";
import { nodeRuntimesDirectory } from "./node-runtime-pointer.js";

/**
 * ADR-0573: whether the running replica coordinator loaded the runtime `current` names.
 * `not_running`: the service manager reports no running process, so nothing can be stale.
 * `current`: the reported process proved, by its own binding record, that it loaded `runtime`.
 * `stale_runtime`: anything else, including a binding to another runtime, no binding, an
 * unreported process id, or an unobservable process. A restart through the service manager
 * is the only remedy, so an unproven binding fails toward a restart, never toward silence.
 */
export type ReplicaProcessRuntime = "not_running" | "current" | "stale_runtime";

export async function observeReplicaProcessRuntime(input: {
  status: { active: boolean; processId?: number | null };
  /** The `<hash16>` runtime directory `current` names, or will name once the stage applies. */
  runtime: string | null;
  homeDirectory: string;
  platform: NodeJS.Platform;
  observeProcess: (pid: number) => ProcessObservation;
}): Promise<ReplicaProcessRuntime> {
  if (!input.status.active) return "not_running";
  const processId = input.status.processId;
  if (input.runtime === null || processId === undefined || processId === null)
    return "stale_runtime";
  const bound = await findRuntimeProcessBinding(
    nodeRuntimesDirectory(input.homeDirectory, input.platform),
    processId,
    input.observeProcess,
  );
  return bound === input.runtime ? "current" : "stale_runtime";
}
