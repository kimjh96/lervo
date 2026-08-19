import { validateSchema, type DeliberationPolicy } from "@lervo/schemas";

import { DeliberationError } from "./types.js";

export function validateDeliberationPolicy(
  policy: DeliberationPolicy,
): void {
  if (!validateSchema("deliberationPolicy", policy).valid) {
    throw new DeliberationError(
      "policy_contract_invalid",
      "policy_schema_invalid",
      "숙의 정책이 schema를 통과하지 못했습니다.",
    );
  }
  const roleIds = policy.participants.map((participant) => participant.roleId);
  const decisionOwners = policy.participants.filter((participant) =>
    participant.responsibilities.includes("decision_owner")
  );
  const proposers = new Set(policy.participants
    .filter((participant) => participant.responsibilities.includes("proposer"))
    .map((participant) => participant.roleId));
  const reviewers = policy.participants
    .filter((participant) => participant.responsibilities.includes("reviewer"))
    .map((participant) => participant.roleId);
  const hasVerifier = policy.participants.some((participant) =>
    participant.responsibilities.includes("verifier")
  );
  if (
    new Set(roleIds).size !== roleIds.length || proposers.size === 0 || reviewers.length === 0 ||
    !hasVerifier || decisionOwners.length !== 1 ||
    decisionOwners[0]?.roleId !== policy.decisionOwnerRoleId ||
    !reviewers.some((roleId) => !proposers.has(roleId))
  ) {
    throw new DeliberationError(
      "policy_contract_invalid",
      "policy_role_assignment_invalid",
      "숙의 정책의 역할은 중복 없이 제안자, 독립 검토자, 검증자와 결정 책임자를 지정해야 합니다.",
    );
  }
}

export function policyAllowsProvider(
  policy: DeliberationPolicy,
  roleId: string,
  provider: string,
): boolean {
  const participant = policy.participants.find((item) => item.roleId === roleId);
  if (!participant) return false;
  return participant.providerSelection.mode === "fixed"
    ? participant.providerSelection.provider === provider
    : participant.providerSelection.providers.includes(provider);
}
