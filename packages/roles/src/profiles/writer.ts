import type { RoleProfile } from "@lervo/schemas";

import { defaultRoleWritingPolicyId, defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "writer",
  name: "Writer",
  description:
    "Produces audience-bound documentation from verified repository evidence and writing policy.",
  requestTypes: ["documentation", "editing", "technical.writing"],
  requiredInputs: [
    {
      name: "writingBrief",
      schemaRef: "lervo-schema://roles/writing-brief/v1",
      required: true,
      sensitive: false,
    },
  ],
  contextPolicy: {
    requiredDocumentRuleIds: ["repository.instructions", "writing.policy"],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow",
    "filesystem.write": "require_approval",
    "shell.execute": "deny",
    "network.access": "deny",
    "external.message": "deny",
    deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "written_document",
    schemaRef: "lervo-schema://roles/written-document/v1",
    pathTemplate: ".lervo/generated/writing/{runId}.md",
    citationsRequired: true,
    presentation: { audience: "human", locale: "en", writingPolicyId: defaultRoleWritingPolicyId },
  },
  verification: { suiteIds: ["role.writing.artifact"], failureDisposition: "fail_run" },
  handoff: {
    allowedRoleIds: ["developer", "designer", "ideation", "marketer", "researcher"],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function writerRoleDefinition() {
  return defineRole(profile, [
    {
      checkId: "writing.artifact-schema",
      category: "artifact_schema",
      method: "project_verification",
      requirement: "The written artifact must satisfy the registered document schema.",
      verificationSuiteId: "role.writing.artifact",
      evidenceRequired: true,
    },
    {
      checkId: "writing.quality",
      category: "writing_quality",
      method: "separate_semantic",
      requirement:
        "A separate evaluator must confirm audience fit, clarity, and policy compliance.",
      verificationSuiteId: null,
      evidenceRequired: true,
    },
  ]);
}
