import type {
  GovernedLoopActionV1,
  GovernedLoopPolicyV1,
  ResourceGroupObservationV1,
} from "@lervo/application-contract";

function dispositionAction(
  disposition: "block" | "escalate",
  reasonCode: "resource_exhausted" | "resource_unobservable",
): GovernedLoopActionV1 {
  return { kind: disposition, assignmentId: null, reasonCode };
}

export function evaluateResourceAdmission(input: {
  resources: readonly ResourceGroupObservationV1[];
  policy: GovernedLoopPolicyV1;
}): GovernedLoopActionV1 | null {
  for (const limit of input.policy.tokenLimits) {
    const matches = input.resources.filter(
      (resource) =>
        resource.provider === limit.provider &&
        (limit.scope === undefined || resource.scope === limit.scope) &&
        resource.accountingDescriptorHash === limit.accountingDescriptorHash,
    );
    if (matches.length !== 1 || matches[0]!.completeness !== "complete") {
      return dispositionAction(input.policy.unobservedResourceAction, "resource_unobservable");
    }
    if (
      (matches[0]!.totalTokens ?? Number.POSITIVE_INFINITY) >= limit.stopAfterObservedTotalTokens
    ) {
      return dispositionAction(input.policy.exhaustedResourceAction, "resource_exhausted");
    }
  }
  return null;
}
