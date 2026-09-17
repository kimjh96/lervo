import {
  organizationIdentityHash,
  projectAgentOrganizationFromEventSource,
  type AgentOrganizationEvent,
  type AgentOrganizationProjection,
} from "@lervo/agent-organization";
import type { ProjectStorage } from "@lervo/project-storage";

export const organizationPolicyHash = organizationIdentityHash({
  schemaVersion: 1,
  authority: "human_owner",
  crossTeamEffects: "explicit_only",
  repositoryAuthority: "isolated",
});

export function organizationCoordinate(prefix: "amem" | "adep" | "cmem", value: unknown): string {
  return `${prefix}_${organizationIdentityHash(value).slice("sha256:".length, 40)}`;
}

export function projectOrganization(storage: ProjectStorage): AgentOrganizationProjection {
  return projectAgentOrganizationFromEventSource({
    projectId: storage.manifest.projectId,
    events: storage.events,
  });
}

export function appendOrganizationEvent(
  storage: ProjectStorage,
  type: AgentOrganizationEvent["type"],
  payload: Record<string, unknown>,
): void {
  const identity = organizationIdentityHash({ type, payload }).slice("sha256:".length, 40);
  const draft = {
    eventId: `evt_${identity}`,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    projectId: storage.manifest.projectId,
    type,
    occurredAt:
      typeof payload.boundAt === "string"
        ? payload.boundAt
        : typeof payload.releasedAt === "string"
          ? payload.releasedAt
          : typeof payload.changedAt === "string"
            ? payload.changedAt
            : typeof payload.retiredAt === "string"
              ? payload.retiredAt
              : new Date().toISOString(),
    actor: { kind: "system" },
    policyVersion: organizationPolicyHash,
    payload,
  } as const;
  storage.events.append(
    (storage.writableEventSchemaVersion ?? 1) >= 2
      ? { ...draft, schemaVersion: 2 }
      : { ...draft, schemaVersion: 1 },
  );
}
