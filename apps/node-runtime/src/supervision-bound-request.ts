import { createHash } from "node:crypto";
import { validateSchema, type ConversationOutboundMessage } from "@lervo/schemas";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash } from "@lervo/work-controller";

import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { hasInstalledMandateLineage } from "./supervision-mandate-lineage.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { ConversationHistoryEvidenceTurn } from "./conversation-history.js";
import { validSupervisionConversationContext } from "./supervision-conversation-context.js";

type Source = Awaited<ReturnType<SupervisionTaskSource["read"]>>;

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export interface BoundSupervisionRequest {
  eventId: string;
  source: "local" | "discord";
  request: string;
  contentHash: string;
  origin: Pick<
    ConversationOutboundMessage,
    "sourceEventId" | "policyId" | "target" | "actor"
  > | null;
  conversationContext: ConversationHistoryEvidenceTurn[] | null;
}

/** Resolves the single exact goal origin; a second origin requires a new reviewed goal. */
export async function readBoundSupervisionRequest(
  storage: ProjectStorage,
  source: Source,
  binding: NodeSupervisionBinding,
): Promise<BoundSupervisionRequest | null> {
  const events = source.supervisionEvents.filter(
    (event) => event.type === "work.supervision.bound",
  );
  if (events.length === 0) return null;
  if (events.length !== 1) throw new Error("The supervised goal has conflicting request origins.");
  const event = events[0]!;
  if (
    event.schemaVersion !== 3 ||
    event.actor.kind !== "system" ||
    event.payload.ownerAgentId !== binding.ownerAgentId ||
    !(await hasInstalledMandateLineage({
      events: storage.events,
      artifacts: storage.artifacts,
      projectId: storage.manifest.projectId,
      binding,
      candidate: event,
    }))
  )
    throw new Error("The supervised request binding is invalid.");
  const artifact = await readSupervisionJsonArtifact(
    storage.artifacts,
    String(event.payload.requestArtifactHash),
  );
  if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact))
    throw new Error("The supervised request artifact is invalid.");
  const request = artifact as Record<string, unknown>;
  if (
    Object.keys(request).sort().join(",") !==
      (request.schemaVersion === 2
        ? "contentHash,conversationContext,kind,origin,request,requesterDigest,schemaVersion,source,sourceDigest"
        : "contentHash,kind,origin,request,requesterDigest,schemaVersion,source,sourceDigest") ||
    ![1, 2].includes(Number(request.schemaVersion)) ||
    request.kind !== "work.supervision.request" ||
    !["local", "discord"].includes(String(request.source)) ||
    typeof request.request !== "string" ||
    request.request.trim().length === 0 ||
    Buffer.byteLength(request.request, "utf8") > 16_384 ||
    typeof request.contentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(request.contentHash) ||
    digest(request.request) !== request.contentHash ||
    (request.schemaVersion === 2 &&
      (request.source !== "discord" ||
        !validSupervisionConversationContext(request.conversationContext))) ||
    (request.source === "local"
      ? request.origin !== null
      : !validateSchema("conversationOutboundOrigin", request.origin).valid) ||
    (request.source === "discord" &&
      request.sourceDigest !==
        digest(
          `discord\0${(request.origin as BoundSupervisionRequest["origin"])!.sourceEventId}`,
        )) ||
    (request.origin !== null &&
      (request.origin as BoundSupervisionRequest["origin"])!.target.projectId !==
        storage.manifest.projectId)
  )
    throw new Error("The supervised request artifact conflicts with its origin.");
  const acceptance = await readSupervisionJsonArtifact(
    storage.artifacts,
    String(event.payload.acceptanceArtifactHash),
  );
  if (
    typeof acceptance !== "object" ||
    acceptance === null ||
    Array.isArray(acceptance) ||
    (acceptance as Record<string, unknown>).kind !== "work.supervision.acceptance" ||
    (acceptance as Record<string, unknown>).workstreamId !== binding.workstreamId ||
    (acceptance as Record<string, unknown>).workstreamRevision !==
      event.payload.workstreamRevision ||
    (acceptance as Record<string, unknown>).workstreamSnapshotHash !==
      source.events.find(
        (item) => item.eventId === (event.payload.causationEventIds as string[])[0],
      )?.payload.snapshotContentHash ||
    operatingContractHash((acceptance as Record<string, unknown>).assignmentIds) !==
      operatingContractHash(
        source.assignments
          .filter((assignment) =>
            source.events.some(
              (item) =>
                item.type === "assignment.created" &&
                item.payload.assignmentId === assignment.assignmentId &&
                item.seq < event.seq,
            ),
          )
          .map((assignment) => assignment.assignmentId)
          .sort(),
      )
  )
    throw new Error("The supervised request acceptance artifact is invalid.");
  return {
    eventId: event.eventId,
    source: request.source as "local" | "discord",
    request: request.request,
    contentHash: request.contentHash,
    origin: request.origin as BoundSupervisionRequest["origin"],
    conversationContext:
      request.schemaVersion === 2
        ? (request.conversationContext as ConversationHistoryEvidenceTurn[])
        : null,
  };
}
