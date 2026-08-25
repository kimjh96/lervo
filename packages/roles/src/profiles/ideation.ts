import type { RoleProfile } from "@lervo/schemas";

import { defaultRoleWritingPolicyId, defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "ideation",
  name: "Ideation",
  description:
    "Generates bounded alternatives, assumptions, and evaluation criteria without presenting speculation as fact.",
  requestTypes: ["brainstorm", "concept.exploration", "option.generation"],
  requiredInputs: [
    {
      name: "ideationBrief",
      schemaRef: "lervo-schema://roles/ideation-brief/v1",
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
    "filesystem.write": "deny",
    "shell.execute": "deny",
    "network.access": "deny",
    "external.message": "deny",
    deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "ideation_options",
    schemaRef: "lervo-schema://roles/ideation-options/v1",
    pathTemplate: ".lervo/generated/ideation/{runId}.md",
    citationsRequired: true,
    presentation: { audience: "human", locale: "en", writingPolicyId: defaultRoleWritingPolicyId },
  },
  verification: { suiteIds: ["role.ideation.artifact"], failureDisposition: "require_review" },
  handoff: {
    allowedRoleIds: ["developer", "designer", "marketer", "researcher", "writer"],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function ideationRoleDefinition() {
  return defineRole(profile, [
    {
      checkId: "ideation.artifact-schema",
      category: "artifact_schema",
      method: "project_verification",
      requirement: "The options artifact must satisfy the registered ideation schema.",
      verificationSuiteId: "role.ideation.artifact",
      evidenceRequired: true,
    },
    {
      checkId: "ideation.feasibility",
      category: "feasibility",
      method: "separate_semantic",
      requirement:
        "A separate evaluator must identify infeasible options and unsupported assumptions.",
      verificationSuiteId: null,
      evidenceRequired: true,
    },
    {
      checkId: "ideation.novelty",
      category: "novelty",
      method: "deterministic",
      requirement: "Each option must have a distinct stable identifier and non-duplicate premise.",
      verificationSuiteId: null,
      evidenceRequired: true,
    },
  ]);
}
