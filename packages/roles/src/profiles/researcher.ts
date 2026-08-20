import type { RoleProfile } from "@lervo/schemas";

import { defaultRoleWritingPolicyId, defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "researcher",
  name: "Researcher",
  description: "질문을 출처와 조회 시각이 있는 근거로 바꾸고 한계까지 기록합니다.",
  requestTypes: ["evidence.review", "research"],
  requiredInputs: [{
    name: "researchQuestion",
    schemaRef: "lervo-schema://roles/research-question/v1",
    required: true,
    sensitive: false,
  }, {
    name: "sourceConstraints",
    schemaRef: "lervo-schema://roles/source-constraints/v1",
    required: true,
    sensitive: false,
  }],
  contextPolicy: {
    requiredDocumentRuleIds: ["repository.instructions", "research.source-policy", "writing.policy"],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow", "filesystem.write": "deny", "shell.execute": "deny",
    "network.access": "require_approval", "external.message": "deny", deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "research_brief",
    schemaRef: "lervo-schema://roles/research-brief/v1",
    pathTemplate: ".lervo/generated/research/{runId}.md",
    citationsRequired: true,
    presentation: {
      audience: "human", locale: "ko-KR", writingPolicyId: defaultRoleWritingPolicyId,
    },
  },
  verification: { suiteIds: ["role.research.artifact"], failureDisposition: "fail_run" },
  handoff: {
    allowedRoleIds: ["designer", "developer", "marketer"],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function researcherRoleDefinition() {
  return defineRole(profile, [{
    checkId: "research.artifact-schema", category: "artifact_schema",
    method: "project_verification",
    requirement: "조사 산출물이 등록된 research brief schema와 맞아야 합니다.",
    verificationSuiteId: "role.research.artifact", evidenceRequired: true,
  }, {
    checkId: "research.citation-integrity", category: "citation_integrity",
    method: "separate_semantic",
    requirement: "각 인용이 실제 출처의 주장과 같은 의미인지 별도 평가자가 확인해야 합니다.",
    verificationSuiteId: null, evidenceRequired: true,
  }, {
    checkId: "research.claim-support", category: "claim_support", method: "separate_semantic",
    requirement: "주요 결론마다 이를 직접 뒷받침하는 출처가 있어야 합니다.",
    verificationSuiteId: null, evidenceRequired: true,
  }, {
    checkId: "research.source-traceability", category: "source_traceability",
    method: "deterministic",
    requirement: "모든 출처에 URL, 조회 시각과 content hash가 있어야 합니다.",
    verificationSuiteId: null, evidenceRequired: true,
  }]);
}
