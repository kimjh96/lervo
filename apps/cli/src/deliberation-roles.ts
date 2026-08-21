import { defaultKoreanWritingContract } from "@lervo/core";
import type { DeliberationPolicy, RoleProfile } from "@lervo/schemas";
import { writingPolicyHash } from "@lervo/writing-contract";

import type { RunProvider } from "./managed-run.js";

export const deliberationRoleIds = {
  proposer: "deliberation-proposer",
  reviewer: "deliberation-reviewer",
  evaluator: "deliberation-writing-evaluator",
} as const;

function participantRole(input: {
  roleId: string;
  name: string;
  description: string;
  verificationSuiteIds: readonly string[];
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
      pathTemplate: ".lervo/state/deliberations/{runId}/content.md",
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
      allowedRoleIds: [deliberationRoleIds.proposer, deliberationRoleIds.reviewer],
      evidenceLinksRequired: true,
      sharedContextRequired: true,
    },
  };
}

export function createDeliberationParticipantRole(input: {
  kind: "proposer" | "reviewer";
  verificationSuiteIds: readonly string[];
}): RoleProfile {
  return participantRole({
    roleId: deliberationRoleIds[input.kind],
    name: input.kind === "proposer" ? "제안·결정 역할" : "독립 검토·검증 역할",
    description: input.kind === "proposer"
      ? "근거가 있는 제안과 수정안, 최종 결정을 작성합니다."
      : "제안을 독립적으로 검토하고 프로젝트 검증 결과를 설명합니다.",
    verificationSuiteIds: input.verificationSuiteIds,
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

export function createCliDeliberationPolicy(input: {
  projectId: string;
  proposerProvider: RunProvider;
  reviewerProvider: RunProvider;
  verificationSuiteIds: readonly string[];
}): DeliberationPolicy {
  return {
    schemaVersion: 1,
    policyId: "deliberation_cli.two-provider-v1",
    projectId: input.projectId,
    participants: [
      {
        roleId: deliberationRoleIds.proposer,
        responsibilities: ["proposer", "decision_owner"],
        providerSelection: { mode: "fixed", provider: input.proposerProvider },
      },
      {
        roleId: deliberationRoleIds.reviewer,
        responsibilities: ["reviewer", "verifier"],
        providerSelection: { mode: "fixed", provider: input.reviewerProvider },
      },
    ],
    decisionOwnerRoleId: deliberationRoleIds.proposer,
    maxRounds: 2,
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
