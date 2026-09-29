import type { ProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import type { ManagedRunRequest } from "./managed-run.js";

/** One durable invocation admission, before any request grounding or provider call. */
export function reserveManagedExecution(
  storage: ProjectStorage,
  request: ManagedRunRequest,
  now: Date,
) {
  if (request.executionKey === undefined) return null;
  if ((storage.writableEventSchemaVersion ?? 1) < 3)
    throw new Error("Stable managed execution requires reviewed event writer version 3.");
  const identity = managedExecutionIdentity(storage.manifest.projectId, request.executionKey);
  const eventId = `evt_${operatingContractHash({ kind: "managed.execution.reserved", ...identity }).slice(7, 39)}`;
  storage.events.transact((transaction) => {
    if (
      collectRunEventsBounded({
        events: storage.events,
        runId: identity.runId,
        maximumEvents: 4096,
      }).some((event) => ["managed.execution.reserved", "run.requested"].includes(event.type))
    )
      throw new Error(
        "This execution key is already reserved; inspect its effects before retrying.",
      );
    const result = transaction.append({
      eventId,
      projectId: storage.manifest.projectId,
      ...identity,
      schemaVersion: 3,
      type: "managed.execution.reserved",
      occurredAt: now.toISOString(),
      actor: { kind: "system" },
      policyVersion: operatingContractHash({ contract: "managed.execution.reservation.v1" }),
      payload: { executionKey: request.executionKey, requestHash: operatingContractHash(request) },
    });
    if (result.redactions.length > 0)
      throw new Error("The managed execution reservation was redacted.");
  });
  return identity;
}
