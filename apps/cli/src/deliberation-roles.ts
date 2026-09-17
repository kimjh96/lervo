import type {
  DeliberationPolicy,
  DeliberationResponsibility,
  DeliberationWorkflowSource,
  RoleProfile,
  WritingContract,
} from "@lervo/schemas";
import { writingPolicyHash } from "@lervo/writing-contract";

import { assertDeliberationCallBudgetFeasible } from "./deliberation-budget-feasibility.js";
import type { RunProvider } from "./managed-run.js";
import { deliberationLanguageFor } from "./deliberation-language.js";

export const deliberationRoleIds = {
  proposer: "deliberation-proposer",
  reviewer: "deliberation-reviewer",
  evaluator: "deliberation-writing-evaluator",
} as const;

export interface DeliberationParticipant {
  role: RoleProfile;
  provider: RunProvider;
  responsibilities: readonly DeliberationResponsibility[];
}

export interface DeliberationExecutionPlan {
  policy: DeliberationPolicy & { executionBudget: DeliberationExecutionBudget };
  writingContract: WritingContract;
  participants: readonly DeliberationParticipant[];
  proposer: DeliberationParticipant;
  reviewers: readonly DeliberationParticipant[];
  verifier: DeliberationParticipant;
}

type DeliberationExecutionBudget = NonNullable<DeliberationPolicy["executionBudget"]>;

const defaultExecutionBudget: DeliberationExecutionBudget = {
  maximumProviderCalls: 12,
  maximumObservedTokens: 200_000,
  maximumElapsedMs: 300_000,
  unobservedTokenDisposition: "block",
};

function participantRole(input: {
  roleId: string;
  name: string;
  description: string;
  verificationSuiteIds: readonly string[];
  allowedRoleIds: readonly string[];
  writingContract: WritingContract;
}): RoleProfile {
  return {
    schemaVersion: 1,
    roleId: input.roleId,
    name: input.name,
    description: input.description,
    requestTypes: ["deliberation"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: ["repository.instructions", "writing.policy"],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "deny",
      "shell.execute": "deny",
      "network.access": "deny",
      "external.message": "deny",
      "computer.use": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind: "deliberation",
      schemaRef: "lervo-schema://deliberation/human-artifact/v1",
      pathTemplate: `.lervo/state/deliberations/{runId}/${input.roleId}.md`,
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: input.writingContract.locale,
        writingPolicyId: input.writingContract.writingPolicyId,
      },
    },
    verification: {
      suiteIds: [...input.verificationSuiteIds],
      failureDisposition: "require_review",
    },
    handoff: {
      allowedRoleIds: [...input.allowedRoleIds],
      evidenceLinksRequired: true,
      sharedContextRequired: true,
    },
  };
}

function policy(input: {
  projectId: string;
  policyId: string;
  maxRounds: number;
  executionBudget: DeliberationExecutionBudget;
  verificationSuiteIds: readonly string[];
  participants: readonly DeliberationParticipant[];
  decisionOwnerRoleId: string;
  writingContract: WritingContract;
}): DeliberationPolicy & { executionBudget: DeliberationExecutionBudget } {
  return {
    schemaVersion: 1,
    policyId: input.policyId,
    projectId: input.projectId,
    participants: input.participants.map((participant) => ({
      roleId: participant.role.roleId,
      responsibilities: [...participant.responsibilities],
      providerSelection: { mode: "fixed", provider: participant.provider },
    })),
    decisionOwnerRoleId: input.decisionOwnerRoleId,
    maxRounds: input.maxRounds,
    executionBudget: structuredClone(input.executionBudget),
    requiredVerificationSuiteIds: [...input.verificationSuiteIds],
    convergence: {
      requireIndependentReviewer: true,
      requireIndependentSessions: true,
      requireDecisionOwnerDecision: true,
      requirePassedVerifications: true,
      requireZeroUnresolvedBlockingObjections: true,
      unresolvedBlockingDisposition: "no_consensus",
    },
    publication: {
      surface: "chat",
      writingPolicyId: input.writingContract.writingPolicyId,
      writingPolicyHash: writingPolicyHash(input.writingContract),
      requiresWritingPermit: true,
    },
  };
}

function executionPlan(input: {
  projectId: string;
  policyId: string;
  maxRounds: number;
  executionBudget: DeliberationExecutionBudget;
  verificationSuiteIds: readonly string[];
  writingContract: WritingContract;
  definitions: readonly {
    roleId: string;
    name: string;
    description: string;
    provider: RunProvider;
    responsibilities: readonly DeliberationResponsibility[];
  }[];
}): DeliberationExecutionPlan {
  const roleIds = input.definitions.map((definition) => definition.roleId);
  const participants = input.definitions.map((definition) => ({
    role: participantRole({
      roleId: definition.roleId,
      name: definition.name,
      description: definition.description,
      verificationSuiteIds: input.verificationSuiteIds,
      allowedRoleIds: roleIds,
      writingContract: input.writingContract,
    }),
    provider: definition.provider,
    responsibilities: [...definition.responsibilities],
  }));
  const proposer = participants.find((participant) =>
    participant.responsibilities.includes("proposer"),
  );
  const reviewers = participants.filter((participant) =>
    participant.responsibilities.includes("reviewer"),
  );
  const verifier = participants.find((participant) =>
    participant.responsibilities.includes("verifier"),
  );
  if (proposer === undefined || reviewers.length === 0 || verifier === undefined) {
    throw new Error("The deliberation execution roles could not be resolved from the policy.");
  }
  const resolvedPolicy = policy({
    projectId: input.projectId,
    policyId: input.policyId,
    maxRounds: input.maxRounds,
    executionBudget: input.executionBudget,
    verificationSuiteIds: input.verificationSuiteIds,
    participants,
    decisionOwnerRoleId: proposer.role.roleId,
    writingContract: input.writingContract,
  });
  assertDeliberationCallBudgetFeasible({
    policy: resolvedPolicy,
    reviewerCount: reviewers.length,
    writingContract: input.writingContract,
  });
  return {
    policy: resolvedPolicy,
    writingContract: structuredClone(input.writingContract),
    participants,
    proposer,
    reviewers,
    verifier,
  };
}

export function createInlineDeliberationExecutionPlan(input: {
  projectId: string;
  proposerProvider: RunProvider;
  reviewerProvider: RunProvider;
  verificationSuiteIds: readonly string[];
  writingContract: WritingContract;
}): DeliberationExecutionPlan {
  if (input.proposerProvider === input.reviewerProvider) {
    throw Object.assign(
      new Error(
        "two-provider-v1 requires different proposer and reviewer providers; use an explicitly named single-provider degradation policy if diversity is unavailable.",
      ),
      { code: "deliberation_provider_diversity_required" },
    );
  }
  const language = deliberationLanguageFor(input.writingContract.locale);
  return executionPlan({
    projectId: input.projectId,
    policyId: "deliberation_cli.two-provider-v1",
    maxRounds: 2,
    executionBudget: defaultExecutionBudget,
    verificationSuiteIds: input.verificationSuiteIds,
    writingContract: input.writingContract,
    definitions: [
      {
        roleId: deliberationRoleIds.proposer,
        name: language.roles.proposerName,
        description: language.roles.proposerDescription,
        provider: input.proposerProvider,
        responsibilities: ["proposer", "decision_owner"],
      },
      {
        roleId: deliberationRoleIds.reviewer,
        name: language.roles.reviewerName,
        description: language.roles.reviewerDescription,
        provider: input.reviewerProvider,
        responsibilities: ["reviewer", "verifier"],
      },
    ],
  });
}

export function createStoredDeliberationExecutionPlan(input: {
  projectId: string;
  source: DeliberationWorkflowSource;
  writingContract: WritingContract;
}): DeliberationExecutionPlan {
  return executionPlan({
    projectId: input.projectId,
    policyId: input.source.policyId,
    maxRounds: input.source.maxRounds,
    executionBudget: input.source.executionBudget ?? defaultExecutionBudget,
    verificationSuiteIds: input.source.requiredVerificationSuiteIds,
    writingContract: input.writingContract,
    definitions: input.source.participants.map((participant) => ({
      roleId: participant.roleId,
      name:
        participant.localizedNames?.[input.writingContract.locale === "ko" ? "ko" : "en"] ??
        participant.name,
      description: participant.description,
      provider: participant.provider as RunProvider,
      responsibilities: participant.responsibilities,
    })),
  });
}

export function createDeliberationEvaluatorRole(
  verificationSuiteId: string,
  writingContract: WritingContract,
): RoleProfile {
  const language = deliberationLanguageFor(writingContract.locale);
  return {
    schemaVersion: 1,
    roleId: deliberationRoleIds.evaluator,
    name: language.roles.evaluatorName,
    description: language.roles.evaluatorDescription,
    requestTypes: ["writing.evaluation"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: ["repository.instructions", "writing.evaluation.request"],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "deny",
      "shell.execute": "deny",
      "network.access": "deny",
      "external.message": "deny",
      "computer.use": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind: "writing_evaluation",
      schemaRef: "lervo-schema://writing/semantic-evaluation-response/v1",
      pathTemplate: ".lervo/state/deliberations/{runId}/evaluation.json",
      citationsRequired: false,
      presentation: { audience: "machine", writingPolicyId: null },
    },
    verification: {
      suiteIds: [verificationSuiteId],
      failureDisposition: "require_review",
    },
    handoff: {
      allowedRoleIds: [],
      evidenceLinksRequired: true,
      sharedContextRequired: true,
    },
  };
}
