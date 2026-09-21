import { organizationIdentityHash } from "./runtime-identity.js";

export interface DeliberationExecutionRouteIdentity {
  participantId: string;
  integrationId: string;
  provider: "codex" | "claude";
  model: string | null;
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max" | null;
}

export function deliberationExecutionRouteHash(input: DeliberationExecutionRouteIdentity): string {
  return organizationIdentityHash({ schemaVersion: 1, ...input });
}

export function deliberationParticipationAssignmentId(input: {
  deliberationId: string;
  policyId: string;
  policyRoleId: string;
  agentId: string;
  executionRouteHash: string;
}): string {
  return `dpa_${organizationIdentityHash({ schemaVersion: 1, ...input })
    .slice("sha256:".length)
    .slice(0, 40)}`;
}
