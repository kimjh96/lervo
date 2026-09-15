import type { RoleProfile } from "@lervo/schemas";

import { defaultRoleWritingPolicyId, defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "designer",
  name: "Designer",
  description:
    "Creates implementable design specifications that follow registered design tokens and accessibility standards.",
  requestTypes: ["design.review", "design.specification"],
  requiredInputs: [
    {
      name: "designBrief",
      schemaRef: "lervo-schema://roles/design-brief/v1",
      required: true,
      sensitive: false,
    },
    {
      name: "designTokens",
      schemaRef: "lervo-schema://roles/design-token-reference/v1",
      required: true,
      sensitive: false,
    },
  ],
  contextPolicy: {
    requiredDocumentRuleIds: [
      "accessibility.policy",
      "design.tokens",
      "repository.instructions",
      "writing.policy",
    ],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow",
    "filesystem.write": "require_approval",
    "shell.execute": "deny",
    "network.access": "deny",
    "external.message": "deny",
    "computer.use": "deny",
    deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "design_specification",
    schemaRef: "lervo-schema://roles/design-specification/v1",
    pathTemplate: ".lervo/generated/design/{runId}.md",
    citationsRequired: true,
    presentation: {
      audience: "human",
      locale: "en",
      writingPolicyId: defaultRoleWritingPolicyId,
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
  return defineRole(profile, [
    {
      checkId: "design.accessibility",
      category: "accessibility",
      method: "separate_semantic",
      requirement:
        "Accessibility standards and exceptions must be confirmed by a separate evaluation.",
      verificationSuiteId: null,
      evidenceRequired: true,
    },
    {
      checkId: "design.artifact-schema",
      category: "artifact_schema",
      method: "project_verification",
      requirement: "The design artifact must satisfy the registered design specification schema.",
      verificationSuiteId: "role.design.artifact",
      evidenceRequired: true,
    },
    {
      checkId: "design.token-usage",
      category: "design_token_usage",
      method: "deterministic",
      requirement:
        "Colors, spacing, typefaces, and sizes must reference registered design token IDs.",
      verificationSuiteId: null,
      evidenceRequired: true,
    },
  ]);
}
