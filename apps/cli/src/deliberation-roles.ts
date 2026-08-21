import { defaultKoreanWritingContract } from "@lervo/core";
import type {
  DeliberationPolicy,
  DeliberationResponsibility,
  DeliberationWorkflowSource,
  RoleProfile,
} from "@lervo/schemas";
import { writingPolicyHash } from "@lervo/writing-contract";

import type { RunProvider } from "./managed-run.js";

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
  policy: DeliberationPolicy;
  participants: readonly DeliberationParticipant[];
  proposer: DeliberationParticipant;
  reviewers: readonly DeliberationParticipant[];
  verifier: DeliberationParticipant;
}

function participantRole(input: {
  roleId: string;
  name: string;
  description: string;
  verificationSuiteIds: readonly string[];
  allowedRoleIds: readonly string[];
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
        locale: "ko-KR",
        writingPolicyId: defaultKoreanWritingContract.writingPolicyId,
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
  verificationSuiteIds: readonly string[];
  participants: readonly DeliberationParticipant[];
  decisionOwnerRoleId: string;
}): DeliberationPolicy {
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
      writingPolicyId: defaultKoreanWritingContract.writingPolicyId,
      writingPolicyHash: writingPolicyHash(defaultKoreanWritingContract),
      requiresWritingPermit: true,
    },
  };
}

function executionPlan(input: {
  projectId: string;
  policyId: string;
  maxRounds: number;
  verificationSuiteIds: readonly string[];
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
    }),
    provider: definition.provider,
    responsibilities: [...definition.responsibilities],
  }));
  const proposer = participants.find((participant) =>
    participant.responsibilities.includes("proposer"));
  const reviewers = participants.filter((participant) =>
    participant.responsibilities.includes("reviewer"));
  const verifier = participants.find((participant) =>
    participant.responsibilities.includes("verifier"));
  if (proposer === undefined || reviewers.length === 0 || verifier === undefined) {
    throw new Error("숙의 실행 역할을 정책에서 해석하지 못했습니다.");
  }
  return {
    policy: policy({
      projectId: input.projectId,
      policyId: input.policyId,
      maxRounds: input.maxRounds,
      verificationSuiteIds: input.verificationSuiteIds,
      participants,
      decisionOwnerRoleId: proposer.role.roleId,
    }),
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
}): DeliberationExecutionPlan {
  return executionPlan({
    projectId: input.projectId,
    policyId: "deliberation_cli.two-provider-v1",
    maxRounds: 2,
    verificationSuiteIds: input.verificationSuiteIds,
    definitions: [{
      roleId: deliberationRoleIds.proposer,
      name: "제안·결정 역할",
      description: "근거가 있는 제안과 수정안, 최종 결정을 작성합니다.",
      provider: input.proposerProvider,
      responsibilities: ["proposer", "decision_owner"],
    }, {
      roleId: deliberationRoleIds.reviewer,
      name: "독립 검토·검증 역할",
      description: "제안을 독립적으로 검토하고 프로젝트 검증 결과를 설명합니다.",
      provider: input.reviewerProvider,
      responsibilities: ["reviewer", "verifier"],
    }],
  });
}

export function createStoredDeliberationExecutionPlan(input: {
  projectId: string;
  source: DeliberationWorkflowSource;
}): DeliberationExecutionPlan {
  return executionPlan({
    projectId: input.projectId,
    policyId: input.source.policyId,
    maxRounds: input.source.maxRounds,
    verificationSuiteIds: input.source.requiredVerificationSuiteIds,
    definitions: input.source.participants.map((participant) => ({
      roleId: participant.roleId,
      name: participant.name,
      description: participant.description,
      provider: participant.provider as RunProvider,
      responsibilities: participant.responsibilities,
    })),
  });
}

export function createDeliberationEvaluatorRole(
  verificationSuiteId: string,
): RoleProfile {
  return {
    schemaVersion: 1,
    roleId: deliberationRoleIds.evaluator,
    name: "한국어 문장 평가 역할",
    description: "공개할 문장이 writing 계약을 지키는지 별도 pass에서 판정합니다.",
    requestTypes: ["writing.evaluation"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: [
        "repository.instructions",
        "writing.evaluation.request",
      ],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "deny",
      "shell.execute": "deny",
      "network.access": "deny",
      "external.message": "deny",
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
