export const groundingIntents = [
  "inspect",
  "explain",
  "change",
  "continue",
  "resolve_approval",
  "coordinate_agents",
  "deliberate",
  "unknown",
] as const;

export type GroundingIntent = (typeof groundingIntents)[number];

export const groundingSourceClasses = [
  "user_context",
  "repository_instructions",
  "current_workstream",
  "durable_decision",
  "repository_state",
  "knowledge_projection",
  "execution_evidence",
] as const;

export type GroundingSourceClass = (typeof groundingSourceClasses)[number];

export const groundingAuthorities = [
  "read",
  "repository_write",
  "user_approval",
  "external_effect",
] as const;

export type GroundingAuthority = (typeof groundingAuthorities)[number];

export const groundingDispositions = ["execute", "answer", "clarify", "abstain"] as const;

export type GroundingDisposition = (typeof groundingDispositions)[number];

export const groundingReferenceKinds = [
  "explicit_coordinate",
  "prior_turn",
  "current_workstream",
  "repository_source",
  "pending_authority",
] as const;

export type GroundingReferenceKind = (typeof groundingReferenceKinds)[number];

export const protocolCoordinateKinds = [
  "agent_id",
  "assignment_id",
  "workstream_id",
  "approval_id",
  "deliberation_id",
  "repository_path",
] as const;

export type ProtocolCoordinateKind = (typeof protocolCoordinateKinds)[number];

export interface GroundingReference {
  referenceId: string;
  kind: GroundingReferenceKind;
  resolution: "resolved" | "unresolved";
}

export interface ProtocolCoordinate {
  kind: ProtocolCoordinateKind;
  value: string;
}

export interface SemanticGroundingProposal {
  schemaVersion: 1;
  requestDigest: string;
  resolver: {
    kind: "provider_adapter";
    providerId: string;
    resultDigest: string;
  };
  intent: GroundingIntent;
  subjectIds: string[];
  references: GroundingReference[];
  protocolCoordinates: ProtocolCoordinate[];
  requestedEffectIds: string[];
  prohibitedEffectIds: string[];
  sourceClasses: GroundingSourceClass[];
  retrievalQueries: string[];
  workflowCandidateIds: string[];
  capabilityCandidateIds: string[];
  authorityRequirement: GroundingAuthority;
  providerRoute:
    | { mode: "current_provider_only"; providerIds: [] }
    | { mode: "cross_provider_deliberation"; providerIds: string[] };
  disposition: GroundingDisposition;
  ambiguityReasons: string[];
}

export interface GroundingWorkflowDescriptor {
  workflowId: string;
  supportedIntents: GroundingIntent[];
  supportedDispositions: Array<"execute" | "answer">;
  effectIds: string[];
  requiredSourceClasses: GroundingSourceClass[];
  authority: GroundingAuthority;
  allowedCapabilityIds: string[];
  crossProviderAllowed: boolean;
}

export interface GroundingDecisionContext {
  currentProviderId: string;
  availableProviderIds: string[];
  availableCapabilityIds: string[];
  grantedAuthorities: GroundingAuthority[];
  workflows: GroundingWorkflowDescriptor[];
}

export const groundingDecisionReasons = [
  "proposal_clarifies",
  "proposal_abstains",
  "intent_unknown",
  "ambiguity_present",
  "reference_unresolved",
  "workflow_ambiguous",
  "workflow_unavailable",
  "intent_not_supported",
  "disposition_not_supported",
  "effect_not_allowed",
  "source_class_missing",
  "authority_mismatch",
  "authority_not_granted",
  "capability_not_allowed",
  "capability_unavailable",
  "provider_route_not_allowed",
  "provider_unavailable",
  "current_provider_missing",
  "semantic_resolution_failed",
] as const;

export type GroundingDecisionReason = (typeof groundingDecisionReasons)[number];

export interface GroundingDecision {
  schemaVersion: 1;
  status: "ready" | "clarify" | "abstain" | "approval_required";
  workflowId: string | null;
  effectIds: string[];
  capabilityIds: string[];
  providerIds: string[];
  authority: GroundingAuthority | null;
  sourceClasses: GroundingSourceClass[];
  subjectIds: string[];
  retrievalQueries: string[];
  reasons: GroundingDecisionReason[];
}
