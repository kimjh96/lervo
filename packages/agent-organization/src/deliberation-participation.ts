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

/**
 * ADR-0612 M2c: the model marker of a deliberation seat whose model and effort the model selection
 * chooses at each start and resume. It never names a real model, so its route hash cannot equal
 * the hash of a configured seat, even one whose model and effort are both unset.
 */
export const SELECTION_ROUTED_DELIBERATION_MODEL = "lervo:model-selection:reasoning";

/** The route hash of a seat the selection routes: its provider, bound with the marker. */
export function selectionRoutedDeliberationRouteHash(
  input: Omit<DeliberationExecutionRouteIdentity, "model" | "reasoningEffort">,
): string {
  return deliberationExecutionRouteHash({
    ...input,
    model: SELECTION_ROUTED_DELIBERATION_MODEL,
    reasoningEffort: null,
  });
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
