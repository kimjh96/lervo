import type { ProjectStorage } from "@lervo/project-storage";
import { roleProfileHash, type ResolvedRoleContract } from "@lervo/roles";
import { stableId } from "@lervo/repository-knowledge";

export function recordManagedRoleProfileActivation(input: {
  storage: ProjectStorage;
  runId: string;
  sessionId: string;
  provider: "codex" | "claude";
  roleContract: ResolvedRoleContract;
  runtimeProfileHash: string;
  activatedAt: string;
  createEventId: () => string;
}): boolean {
  if ((input.storage.writableEventSchemaVersion ?? 1) < 2) return false;

  const roleProfileContentHash = roleProfileHash(input.roleContract.definition.profile);
  input.storage.events.append({
    eventId: input.createEventId(),
    projectId: input.storage.manifest.projectId,
    runId: input.runId,
    sessionId: input.sessionId,
    type: "role.profile.activated",
    occurredAt: input.activatedAt,
    actor: { kind: "system" },
    schemaVersion: 2,
    policyVersion: input.runtimeProfileHash,
    payload: {
      activationId: stableId("rpact", {
        runId: input.runId,
        roleContractHash: input.roleContract.contractHash,
        runtimeProfileHash: input.runtimeProfileHash,
      }),
      provider: input.provider,
      roleId: input.roleContract.roleId,
      roleVersion: input.roleContract.version,
      roleContractHash: input.roleContract.contractHash,
      roleProfileHash: roleProfileContentHash,
      runtimeProfileHash: input.runtimeProfileHash,
      sourceKind: input.roleContract.sourceKind,
      activatedAt: input.activatedAt,
    },
  });
  return true;
}
