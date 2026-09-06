import type { ProjectStorage } from "@lervo/project-storage";
import type { RoleProfileActivationEvidence } from "@lervo/repository-knowledge";
import {
  validateSchema,
  type EventEnvelope,
  type RoleProfileActivatedEventPayload,
} from "@lervo/schemas";
import { visitEventSnapshot } from "@lervo/storage-contract";

export function roleProfileActivationEvidence(
  storage: ProjectStorage,
): RoleProfileActivationEvidence[] {
  const evidence: RoleProfileActivationEvidence[] = [];
  const latest = storage.events.latest();
  if (latest === null) return evidence;
  visitEventSnapshot({
    events: storage.events,
    throughSeq: latest.seq,
    visit: (event: EventEnvelope) => {
      if (event.type !== "role.profile.activated") return;
      if (
        !validateSchema("event", event).valid ||
        !validateSchema("roleProfileActivatedEventPayload", event.payload).valid
      )
        throw new Error("The role-profile activation event is invalid.");
      const payload = event.payload as RoleProfileActivatedEventPayload;
      if (payload.provider !== "codex" && payload.provider !== "claude")
        throw new Error("The role-profile activation provider is unsupported.");
      evidence.push({
        eventId: event.eventId,
        eventHash: event.eventHash,
        runId: event.runId,
        provider: payload.provider,
        roleId: payload.roleId,
        roleVersion: payload.roleVersion,
        roleContractHash: payload.roleContractHash,
        roleProfileHash: payload.roleProfileHash,
        runtimeProfileHash: payload.runtimeProfileHash,
      });
    },
  });
  return evidence;
}
