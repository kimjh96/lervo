import type { RoleProfile } from "@lervo/schemas";

import { defaultRoleWritingPolicyId, defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "marketer",
  name: "Marketer",
  description: "Creates material for a target audience within verified evidence and brand policy.",
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
      audience: "human", locale: "en", writingPolicyId: defaultRoleWritingPolicyId,
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
    requirement: "The marketing artifact must satisfy the registered marketing content schema.",
    verificationSuiteId: "role.marketing.artifact", evidenceRequired: true,
  }, {
    checkId: "marketing.brand-compliance", category: "brand_compliance",
    method: "separate_semantic",
    requirement: "Language, promises, and prohibited phrases must follow the current brand policy.",
    verificationSuiteId: null, evidenceRequired: true,
  }, {
    checkId: "marketing.claim-support", category: "claim_support",
    method: "separate_semantic",
    requirement: "Factual claims presented externally must link to verified research evidence.",
    verificationSuiteId: null, evidenceRequired: true,
  }]);
}
