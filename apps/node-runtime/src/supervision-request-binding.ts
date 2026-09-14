import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { ConversationOutboundMessage } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";
import { operatingContractHash } from "@lervo/work-controller";

import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readBoundSupervisionRequest } from "./supervision-bound-request.js";
import { SupervisionRequestRefusedError } from "./supervision-request-refusal.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

export interface SupervisionRequestInput {
  source: "local" | "discord";
  sourceId: string;
  requesterId: string;
  request: string;
  contentHash: string;
  origin?: Pick<ConversationOutboundMessage, "sourceEventId" | "policyId" | "target" | "actor">;
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Binds one authenticated request to the installed owner and current assignment graph. */
export async function bindSupervisionRequest(input: {
  storage: ProjectStorage;
  tasks: SupervisionTaskSource;
  binding: NodeSupervisionBinding;
  now(): string;
  commit<T>(effect: () => T): T;
  request: SupervisionRequestInput;
}): Promise<{ eventId: string; duplicate: boolean }> {
  const { storage, tasks, binding, request, now } = input;
  if (
    !request.sourceId ||
    request.sourceId.length > 256 ||
    !request.requesterId ||
    request.requesterId.length > 256 ||
    request.request.trim().length === 0 ||
    Buffer.byteLength(request.request, "utf8") > 16_384 ||
    request.request.includes("\0") ||
    !/^sha256:[a-f0-9]{64}$/u.test(request.contentHash) ||
    digest(request.request) !== request.contentHash ||
    (request.source === "local") !== (request.origin === undefined) ||
    (request.origin !== undefined &&
      (!validateSchema("conversationOutboundOrigin", request.origin).valid ||
        request.origin.sourceEventId !== request.sourceId ||
        request.origin.target.projectId !== storage.manifest.projectId))
  )
    throw new SupervisionRequestRefusedError(
      "request_invalid",
      "The supervised request source or content is invalid.",
    );
  const sourceDigest = digest(`${request.source}\0${request.sourceId}`);
  const requesterDigest = digest(request.requesterId);
  const requestArtifact = {
    schemaVersion: 1,
    kind: "work.supervision.request",
    source: request.source,
    sourceDigest,
    requesterDigest,
    contentHash: request.contentHash,
    request: request.request,
    origin: request.origin ?? null,
  } as const;
  const identity = operatingContractHash({ binding, sourceDigest });
  const runId = `run_${operatingContractHash({ supervisionId: binding.supervisionId }).slice(7, 39)}`;
  const eventId = `evt_${operatingContractHash({ runId, type: "work.supervision.bound", identity }).slice(7, 39)}`;
  const existing = storage.events.get(eventId);
  if (existing !== null) {
    const prior = await readSupervisionJsonArtifact(
      storage.artifacts,
      String(existing.payload.requestArtifactHash),
    );
    if (
      existing.type !== "work.supervision.bound" ||
      existing.schemaVersion !== 3 ||
      existing.projectId !== storage.manifest.projectId ||
      existing.payload.supervisionId !== binding.supervisionId ||
      existing.payload.ownerAgentId !== binding.ownerAgentId ||
      existing.payload.mandateHash !== binding.mandateHash ||
      typeof prior !== "object" ||
      prior === null ||
      operatingContractHash(prior) !== operatingContractHash(requestArtifact)
    )
      throw new SupervisionRequestRefusedError(
        "identity_conflict",
        "The supervised request identity conflicts with canonical evidence.",
      );
    return { eventId, duplicate: true };
  }
  const authority = await observeNodeSupervisionAuthority(storage, binding, now);
  const source = await tasks.read();
  if (
    source.workstream.status !== "active" ||
    source.workstream.workstreamId !== binding.workstreamId ||
    authority.source.workstreamRevision !== source.workstream.revision ||
    authority.installation.mandateHash !== binding.mandateHash
  )
    throw new SupervisionRequestRefusedError(
      "workstream_inactive",
      "The supervised request has no active owned workstream.",
    );
  if (source.supervisionEvents.some((event) => event.type === "work.supervision.bound")) {
    const bound = await readBoundSupervisionRequest(storage, source, binding);
    const prior = await readSupervisionJsonArtifact(
      storage.artifacts,
      String(
        source.supervisionEvents.find((event) => event.eventId === bound?.eventId)?.payload
          .requestArtifactHash,
      ),
    );
    if (bound !== null && operatingContractHash(prior) === operatingContractHash(requestArtifact))
      return { eventId: bound.eventId, duplicate: true };
    throw new SupervisionRequestRefusedError(
      "origin_conflict",
      "The workstream already has a supervised request origin.",
    );
  }
  const acceptanceArtifact = {
    schemaVersion: 1,
    kind: "work.supervision.acceptance",
    workstreamId: binding.workstreamId,
    workstreamRevision: source.workstream.revision,
    workstreamSnapshotHash: source.workstreamHash,
    objective: source.workstream.objective,
    assignmentIds: source.assignments.map((assignment) => assignment.assignmentId).sort(),
  } as const;
  const [requestStored, acceptanceStored] = await Promise.all([
    storage.artifacts.put(canonicalJson(requestArtifact)),
    storage.artifacts.put(canonicalJson(acceptanceArtifact)),
  ]);
  const payload = {
    schemaVersion: 1,
    projectId: storage.manifest.projectId,
    workstreamId: binding.workstreamId,
    workstreamRevision: source.workstream.revision,
    supervisionId: binding.supervisionId,
    ownerAgentId: binding.ownerAgentId,
    mandateHash: binding.mandateHash,
    causationEventIds: [source.sourceEventId],
    requestArtifactHash: requestStored.contentHash,
    acceptanceArtifactHash: acceptanceStored.contentHash,
    expectedGraphHash: source.graph.graphHash,
  };
  const currentAuthority = await observeNodeSupervisionAuthority(storage, binding, now);
  const currentSource = await tasks.read();
  if (
    currentAuthority.source.sourceRevisionDigest !== authority.source.sourceRevisionDigest ||
    currentSource.sourceRevisionDigest !== source.sourceRevisionDigest
  )
    throw new SupervisionRequestRefusedError(
      "authority_changed",
      "The supervised request authority changed before admission.",
    );
  let duplicate = false;
  input.commit(() => {
    storage.events.transact((transaction) => {
      if (storage.events.latest()?.eventHash !== source.events.at(-1)?.eventHash)
        throw new SupervisionRequestRefusedError(
          "evidence_changed",
          "The supervised request evidence changed at commit.",
        );
      const existing = storage.events.get(eventId);
      if (existing !== null) {
        if (
          existing.type !== "work.supervision.bound" ||
          canonicalJson(existing.payload) !== canonicalJson(payload)
        )
          throw new SupervisionRequestRefusedError(
            "identity_conflict",
            "The supervised request identity conflicts with canonical evidence.",
          );
        duplicate = true;
        return;
      }
      const bound = source.supervisionEvents.filter(
        (event) => event.type === "work.supervision.bound",
      );
      if (bound.length > 0)
        throw new SupervisionRequestRefusedError(
          "origin_conflict",
          "The workstream already has a supervised request origin.",
        );
      transaction.append({
        eventId,
        projectId: storage.manifest.projectId,
        runId,
        sessionId: `ses_${operatingContractHash(binding).slice(7, 39)}`,
        type: "work.supervision.bound",
        schemaVersion: 3,
        policyVersion: operatingContractHash({ contract: "node.supervision.request.v1" }),
        occurredAt: now(),
        actor: { kind: "system" },
        payload,
      });
    });
  });
  return { eventId, duplicate };
}
