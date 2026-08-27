import type {
  GroundingDecision,
  GroundingDecisionContext,
  GroundingDecisionReason,
  GroundingWorkflowDescriptor,
  SemanticGroundingProposal,
} from "./types.js";

function terminalDecision(
  status: GroundingDecision["status"],
  proposal: SemanticGroundingProposal,
  reasons: GroundingDecisionReason[],
): GroundingDecision {
  return {
    schemaVersion: 1,
    status,
    workflowId: null,
    effectIds: [],
    capabilityIds: [],
    providerIds: [],
    authority: null,
    sourceClasses: proposal.sourceClasses,
    subjectIds: proposal.subjectIds,
    retrievalQueries: proposal.retrievalQueries,
    reasons,
  };
}

function workflowFor(
  proposal: SemanticGroundingProposal,
  context: GroundingDecisionContext,
): GroundingWorkflowDescriptor | GroundingDecision {
  if (proposal.workflowCandidateIds.length !== 1) {
    return terminalDecision("clarify", proposal, ["workflow_ambiguous"]);
  }
  const workflow = context.workflows.find(
    (candidate) => candidate.workflowId === proposal.workflowCandidateIds[0],
  );
  return workflow ?? terminalDecision("abstain", proposal, ["workflow_unavailable"]);
}

function invalidWorkflowReason(
  workflow: GroundingWorkflowDescriptor,
  proposal: SemanticGroundingProposal,
): GroundingDecisionReason | null {
  if (!workflow.supportedIntents.includes(proposal.intent)) return "intent_not_supported";
  if (!workflow.supportedDispositions.includes(proposal.disposition as "execute" | "answer")) {
    return "disposition_not_supported";
  }
  if (
    proposal.requestedEffectIds.length !== workflow.effectIds.length ||
    proposal.requestedEffectIds.some((effectId) => !workflow.effectIds.includes(effectId))
  ) {
    return "effect_not_allowed";
  }
  if (
    workflow.requiredSourceClasses.some(
      (sourceClass) => !proposal.sourceClasses.includes(sourceClass),
    )
  ) {
    return "source_class_missing";
  }
  if (workflow.authority !== proposal.authorityRequirement) return "authority_mismatch";
  if (
    proposal.capabilityCandidateIds.some(
      (capabilityId) => !workflow.allowedCapabilityIds.includes(capabilityId),
    )
  ) {
    return "capability_not_allowed";
  }
  if (
    proposal.providerRoute.mode === "cross_provider_deliberation" &&
    !workflow.crossProviderAllowed
  ) {
    return "provider_route_not_allowed";
  }
  return null;
}

function providersFor(
  proposal: SemanticGroundingProposal,
  context: GroundingDecisionContext,
): string[] | GroundingDecision {
  if (!context.availableProviderIds.includes(context.currentProviderId)) {
    return terminalDecision("abstain", proposal, ["current_provider_missing"]);
  }
  if (proposal.providerRoute.mode === "current_provider_only") return [context.currentProviderId];
  if (proposal.providerRoute.providerIds.some((id) => !context.availableProviderIds.includes(id))) {
    return terminalDecision("abstain", proposal, ["provider_unavailable"]);
  }
  if (!proposal.providerRoute.providerIds.includes(context.currentProviderId)) {
    return terminalDecision("abstain", proposal, ["current_provider_missing"]);
  }
  return proposal.providerRoute.providerIds;
}

export function decideGroundedRequest(input: {
  proposal: SemanticGroundingProposal;
  context: GroundingDecisionContext;
}): GroundingDecision {
  const { proposal, context } = input;
  if (proposal.disposition === "clarify") {
    return terminalDecision("clarify", proposal, ["proposal_clarifies"]);
  }
  if (proposal.disposition === "abstain") {
    return terminalDecision("abstain", proposal, ["proposal_abstains"]);
  }
  if (proposal.intent === "unknown") {
    return terminalDecision("clarify", proposal, ["intent_unknown"]);
  }
  if (proposal.ambiguityReasons.length > 0) {
    return terminalDecision("clarify", proposal, ["ambiguity_present"]);
  }
  if (proposal.references.some((reference) => reference.resolution === "unresolved")) {
    return terminalDecision("clarify", proposal, ["reference_unresolved"]);
  }
  const workflow = workflowFor(proposal, context);
  if ("status" in workflow) return workflow;
  const invalidReason = invalidWorkflowReason(workflow, proposal);
  if (invalidReason !== null) return terminalDecision("abstain", proposal, [invalidReason]);
  if (!context.grantedAuthorities.includes(proposal.authorityRequirement)) {
    return terminalDecision("approval_required", proposal, ["authority_not_granted"]);
  }
  if (
    proposal.capabilityCandidateIds.some(
      (capabilityId) => !context.availableCapabilityIds.includes(capabilityId),
    )
  ) {
    return terminalDecision("abstain", proposal, ["capability_unavailable"]);
  }
  const providers = providersFor(proposal, context);
  if (!Array.isArray(providers)) return providers;
  return {
    schemaVersion: 1,
    status: "ready",
    workflowId: workflow.workflowId,
    effectIds: proposal.requestedEffectIds,
    capabilityIds: proposal.capabilityCandidateIds,
    providerIds: providers,
    authority: proposal.authorityRequirement,
    sourceClasses: proposal.sourceClasses,
    subjectIds: proposal.subjectIds,
    retrievalQueries: proposal.retrievalQueries,
    reasons: [],
  };
}
