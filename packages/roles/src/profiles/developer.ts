import type { RoleProfile } from "@lervo/schemas";

import { defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "developer",
  name: "Developer",
  description:
    "Implements bounded repository changes under explicit capability and verification contracts.",
  requestTypes: ["implementation", "maintenance", "technical.review"],
  requiredInputs: [],
  contextPolicy: {
    requiredDocumentRuleIds: ["repository.instructions"],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow",
    "filesystem.write": "require_approval",
    "shell.execute": "allow",
    "network.access": "deny",
    "external.message": "deny",
    deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "source_code",
    schemaRef: "lervo-schema://roles/development-artifact/v1",
    pathTemplate: ".lervo/generated/development/{runId}.json",
    citationsRequired: false,
    presentation: { audience: "machine", writingPolicyId: null },
  },
  verification: { suiteIds: ["role.development.artifact"], failureDisposition: "fail_run" },
  handoff: {
    allowedRoleIds: ["designer", "ideation", "marketer", "researcher", "writer"],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function developerRoleDefinition() {
  return defineRole(profile, [
    {
      checkId: "development.artifact-schema",
      category: "artifact_schema",
      method: "project_verification",
      requirement:
        "The implementation artifact must satisfy the registered development artifact schema.",
      verificationSuiteId: "role.development.artifact",
      evidenceRequired: true,
    },
  ]);
}
