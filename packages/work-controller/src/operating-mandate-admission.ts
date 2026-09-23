import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
  OperatingMandate,
  OperatingPolicyReviewV1,
} from "@lervo/application-contract";

import { digest } from "./hash.js";
import {
  assertOperatingActionPlan,
  assertOperatingMandate,
  operatingHashPattern,
  operatingInteger,
  operatingTime,
} from "./operating-contract-validation.js";
import { repositoryPathWithinScope } from "./repository-path-scope.js";

export function operatingContractHash(value: unknown): string {
  return digest(value);
}

export function operatingDecisionId(plan: OperatingActionPlanV1): string {
  assertOperatingActionPlan(plan);
  return `osd_${digest({
    supervisionId: plan.supervisionId,
    causes: [...plan.causationEventIds].sort(),
    source: plan.sourceRevisionDigest,
    action: plan.actionKind,
    planHash: digest(plan),
  }).slice(7, 31)}`;
}

export function operatingEffectAdmissionHash(plan: OperatingActionPlanV1): string {
  return digest({
    actionKind: plan.actionKind,
    effectContract: plan.effectContract,
    effectHash: plan.effectHash,
    responsibilityArtifactHash: plan.responsibilityArtifactHash,
    roleId: plan.roleId,
    requiredCapabilities: plan.requiredCapabilities,
    expectedPaths: plan.expectedPaths,
    provider: plan.provider,
    addedWorkers: plan.addedWorkers,
    addedAssignments: plan.addedAssignments,
    concurrentAttempts: plan.concurrentAttempts,
    attemptNumber: plan.attemptNumber,
    reservedTokens: plan.reservedTokens,
    deadline: plan.deadline,
  });
}

/** Cumulative usage is an admission boundary only when the reviewed mandate says so. */
export function operatingAggregateBudgetRequired(mandate: OperatingMandate): boolean {
  return mandate.schemaVersion !== 3 || mandate.aggregateTokenPolicy?.mode !== "per_attempt_only";
}

export function reviewOperatingAction(input: {
  mandate: OperatingMandate;
  plan: OperatingActionPlanV1;
  snapshot: OperatingAdmissionSnapshotV1;
}): OperatingPolicyReviewV1 {
  const { mandate, plan, snapshot } = input;
  assertOperatingMandate(mandate);
  assertOperatingActionPlan(plan);
  if (
    !operatingTime(snapshot.observedAt) ||
    ![snapshot.sourceRevisionDigest, snapshot.graphHash, snapshot.effectAdmissionHash].every(
      (item) => operatingHashPattern.test(item),
    ) ||
    ![snapshot.installedMandateHash, snapshot.installationReviewHash].every(
      (item) => item === null || operatingHashPattern.test(item),
    ) ||
    ![
      snapshot.activeWorkers,
      snapshot.activeAttempts,
      snapshot.observedAggregateTokens,
      snapshot.reservedAggregateTokens,
    ].every((item) => item === null || operatingInteger(item)) ||
    !operatingInteger(snapshot.assignmentCount, 0, 256) ||
    ![
      snapshot.revoked,
      snapshot.ancestryValid,
      snapshot.historyValid,
      snapshot.liveResponsibilityLease,
    ].every((item) => typeof item === "boolean") ||
    !["within", "exhausted", "unobserved"].includes(snapshot.resourceAdmission) ||
    !Array.isArray(snapshot.effectMappings) ||
    snapshot.effectMappings.length > 32
  ) {
    throw new TypeError("The operating admission snapshot is invalid.");
  }
  const reasons: string[] = [];
  const block = (condition: boolean, reason: string) => {
    if (condition) reasons.push(reason);
  };
  const mandateHash = digest(mandate);
  const now = Date.parse(snapshot.observedAt);
  block(
    snapshot.installedMandateHash !== mandateHash ||
      plan.mandateHash !== mandateHash ||
      snapshot.installationReviewHash === null,
    "mandate_not_installed",
  );
  block(
    snapshot.revoked || snapshot.revocationCoordinate !== mandate.revocationCoordinate,
    "mandate_revoked",
  );
  block(
    now < Date.parse(mandate.issuedAt) || now >= Date.parse(mandate.expiresAt),
    "mandate_expired",
  );
  block(!snapshot.ancestryValid, "ancestry_invalid");
  block(!snapshot.historyValid, "history_invalid");
  block(
    snapshot.effectAdmissionHash !== operatingEffectAdmissionHash(plan),
    "effect_scope_mismatch",
  );
  block(
    plan.sourceRevisionDigest !== snapshot.sourceRevisionDigest ||
      plan.graphHash !== snapshot.graphHash,
    "source_changed",
  );
  block(plan.ownerAgentId !== mandate.ownerAgentId, "owner_mismatch");
  block(
    !mandate.projectIds.includes(plan.projectId) || !mandate.teamIds.includes(plan.teamId),
    "team_scope_exceeded",
  );
  block(!mandate.actionKinds.includes(plan.actionKind), "action_not_allowed");
  block(
    !snapshot.effectMappings.some(
      (item) => item.actionKind === plan.actionKind && item.contract === plan.effectContract,
    ),
    "effect_mapping_unavailable",
  );
  block(!mandate.roleIds.includes(plan.roleId), "role_scope_exceeded");
  block(!mandate.providers.includes(plan.provider), "provider_not_allowed");
  block(
    plan.requiredCapabilities.some((item) => !mandate.capabilityCeiling.includes(item)),
    "capability_ceiling_exceeded",
  );
  block(
    plan.expectedPaths.some(
      (path) => !mandate.pathRoots.some((root) => repositoryPathWithinScope(path, root)),
    ),
    "path_scope_exceeded",
  );
  block(snapshot.activeWorkers === null || snapshot.activeAttempts === null, "capacity_unobserved");
  block(
    snapshot.activeWorkers !== null &&
      snapshot.activeWorkers + plan.addedWorkers > mandate.maximumWorkers,
    "worker_capacity_exceeded",
  );
  block(
    snapshot.activeAttempts !== null &&
      snapshot.activeAttempts + plan.concurrentAttempts > mandate.maximumConcurrentAttempts,
    "concurrency_exceeded",
  );
  block(snapshot.assignmentCount + plan.addedAssignments > 256, "assignment_capacity_exceeded");
  block(plan.attemptNumber > mandate.maximumAttemptsPerAssignment, "retry_limit_exceeded");
  block(plan.reservedTokens > mandate.maximumAttemptTokens, "attempt_budget_exceeded");
  const aggregateBounded = operatingAggregateBudgetRequired(mandate);
  block(
    aggregateBounded &&
      (snapshot.observedAggregateTokens === null || snapshot.reservedAggregateTokens === null),
    "usage_unobserved",
  );
  if (
    aggregateBounded &&
    snapshot.observedAggregateTokens !== null &&
    snapshot.reservedAggregateTokens !== null
  ) {
    block(
      plan.reservedTokens >
        mandate.maximumAggregateTokens -
          snapshot.observedAggregateTokens -
          snapshot.reservedAggregateTokens,
      "aggregate_budget_exceeded",
    );
  }
  block(
    aggregateBounded && snapshot.resourceAdmission !== "within",
    `resource_${snapshot.resourceAdmission}`,
  );
  block(
    plan.actionKind === "revise_responsibility" && snapshot.liveResponsibilityLease,
    "responsibility_lease_unresolved",
  );
  block(
    Date.parse(plan.deadline) <= now ||
      Date.parse(plan.deadline) > Date.parse(mandate.expiresAt) ||
      Date.parse(plan.deadline) - now > mandate.maximumDeadlineMs,
    "deadline_outside_mandate",
  );
  const planHash = digest(plan);
  const content = {
    schemaVersion: 1 as const,
    kind: "operating_policy.review" as const,
    reviewMode: "mandate_policy_v1" as const,
    reviewerPolicyId: "lervo.operating-mandate.v1" as const,
    mandateHash,
    installationReviewHash: snapshot.installationReviewHash,
    planHash,
    graphHash: snapshot.graphHash,
    sourceRevisionDigest: snapshot.sourceRevisionDigest,
    snapshotHash: digest(snapshot),
    decisionId: operatingDecisionId(plan),
    disposition: reasons.length === 0 ? ("admitted" as const) : ("blocked" as const),
    reasonCodes: [...new Set(reasons)].sort(),
  };
  return { ...content, reviewHash: digest(content) };
}
