import type { RoleProfile } from "@lervo/schemas";

import { defaultRoleWritingPolicyId, defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "designer",
  name: "Designer",
  description: "등록된 디자인 토큰과 접근성 기준에 맞는 구현 가능한 디자인 명세를 만듭니다.",
  requestTypes: ["design.review", "design.specification"],
  requiredInputs: [{
    name: "designBrief", schemaRef: "lervo-schema://roles/design-brief/v1",
    required: true, sensitive: false,
  }, {
    name: "designTokens", schemaRef: "lervo-schema://roles/design-token-reference/v1",
    required: true, sensitive: false,
  }],
  contextPolicy: {
    requiredDocumentRuleIds: [
      "accessibility.policy", "design.tokens", "repository.instructions", "writing.policy",
    ],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow", "filesystem.write": "require_approval",
    "shell.execute": "deny", "network.access": "deny", "external.message": "deny",
    deploy: "deny", "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "design_specification",
    schemaRef: "lervo-schema://roles/design-specification/v1",
    pathTemplate: ".lervo/generated/design/{runId}.md",
    citationsRequired: true,
    presentation: {
      audience: "human", locale: "ko-KR", writingPolicyId: defaultRoleWritingPolicyId,
    },
  },
  verification: { suiteIds: ["role.design.artifact"], failureDisposition: "fail_run" },
  handoff: {
    allowedRoleIds: ["developer", "marketer", "researcher"],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function designerRoleDefinition() {
  return defineRole(profile, [{
    checkId: "design.accessibility", category: "accessibility", method: "separate_semantic",
    requirement: "접근성 기준과 예외가 별도 평가에서 확인되어야 합니다.",
    verificationSuiteId: null, evidenceRequired: true,
  }, {
    checkId: "design.artifact-schema", category: "artifact_schema",
    method: "project_verification",
    requirement: "디자인 산출물이 등록된 design specification schema와 맞아야 합니다.",
    verificationSuiteId: "role.design.artifact", evidenceRequired: true,
  }, {
    checkId: "design.token-usage", category: "design_token_usage", method: "deterministic",
    requirement: "색상, 간격, 서체와 크기는 등록된 design token ID를 참조해야 합니다.",
    verificationSuiteId: null, evidenceRequired: true,
  }]);
}
