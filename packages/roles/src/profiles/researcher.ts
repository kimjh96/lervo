import type { RoleProfile } from "@lervo/schemas";

import { defaultRoleWritingPolicyId, defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "researcher",
  name: "Researcher",
  description: "Turns questions into evidence with sources and retrieval times, while recording limitations.",
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
      audience: "human", locale: "en", writingPolicyId: defaultRoleWritingPolicyId,
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
    requirement: "The research artifact must satisfy the registered research brief schema.",
    verificationSuiteId: "role.research.artifact", evidenceRequired: true,
  }, {
    checkId: "research.citation-integrity", category: "citation_integrity",
    method: "separate_semantic",
    requirement: "A separate evaluator must confirm that each citation preserves the source claim's meaning.",
    verificationSuiteId: null, evidenceRequired: true,
  }, {
    checkId: "research.claim-support", category: "claim_support", method: "separate_semantic",
    requirement: "Every major conclusion must have a source that directly supports it.",
    verificationSuiteId: null, evidenceRequired: true,
  }, {
    checkId: "research.source-traceability", category: "source_traceability",
    method: "deterministic",
    requirement: "Every source must include a URL, retrieval time, and content hash.",
    verificationSuiteId: null, evidenceRequired: true,
  }]);
}
