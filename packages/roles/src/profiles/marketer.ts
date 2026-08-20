import type { RoleProfile } from "@lervo/schemas";

import { defaultRoleWritingPolicyId, defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "marketer",
  name: "Marketer",
  description: "검증된 근거와 브랜드 정책 안에서 대상 독자에게 전달할 내용을 만듭니다.",
  requestTypes: ["campaign.plan", "marketing.copy"],
  requiredInputs: [{
    name: "audience", schemaRef: "lervo-schema://roles/marketing-audience/v1",
    required: true, sensitive: false,
  }, {
    name: "marketingBrief", schemaRef: "lervo-schema://roles/marketing-brief/v1",
    required: true, sensitive: false,
  }, {
    name: "researchEvidence", schemaRef: "lervo-schema://roles/research-evidence-reference/v1",
    required: true, sensitive: false,
  }],
  contextPolicy: {
    requiredDocumentRuleIds: [
      "brand.policy", "marketing.claim-policy", "repository.instructions", "writing.policy",
    ],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow", "filesystem.write": "deny", "shell.execute": "deny",
    "network.access": "deny", "external.message": "require_approval", deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "marketing_content",
    schemaRef: "lervo-schema://roles/marketing-content/v1",
    pathTemplate: ".lervo/generated/marketing/{runId}.md",
    citationsRequired: true,
    presentation: {
      audience: "human", locale: "ko-KR", writingPolicyId: defaultRoleWritingPolicyId,
    },
  },
  verification: { suiteIds: ["role.marketing.artifact"], failureDisposition: "fail_run" },
  handoff: {
    allowedRoleIds: ["designer", "researcher"],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function marketerRoleDefinition() {
  return defineRole(profile, [{
    checkId: "marketing.artifact-schema", category: "artifact_schema",
    method: "project_verification",
    requirement: "마케팅 산출물이 등록된 marketing content schema와 맞아야 합니다.",
    verificationSuiteId: "role.marketing.artifact", evidenceRequired: true,
  }, {
    checkId: "marketing.brand-compliance", category: "brand_compliance",
    method: "separate_semantic",
    requirement: "표현, 약속과 금지 문구가 현재 브랜드 정책을 따라야 합니다.",
    verificationSuiteId: null, evidenceRequired: true,
  }, {
    checkId: "marketing.claim-support", category: "claim_support",
    method: "separate_semantic",
    requirement: "외부에 제시하는 사실 주장은 검증된 research evidence와 연결되어야 합니다.",
    verificationSuiteId: null, evidenceRequired: true,
  }]);
}
