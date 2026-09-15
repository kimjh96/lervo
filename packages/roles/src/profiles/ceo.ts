import type { RoleProfile } from "@lervo/schemas";

import { defineRole } from "../profile-builder.js";

const profile: RoleProfile = {
  schemaVersion: 1,
  roleId: "ceo",
  name: "Chief executive agent",
  description:
    "Coordinates project teams, delegates bounded work, convenes review, and proposes organization actions under owner policy.",
  requestTypes: [
    "organization.inspect",
    "organization.coordinate",
    "team.create",
    "agent.hire",
    "assignment.delegate",
    "deliberation.convene",
  ],
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
    "network.access": "require_approval",
    "external.message": "require_approval",
    "computer.use": "require_approval",
    deploy: "require_approval",
    "data.mutate": "require_approval",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "organization_decision",
    schemaRef: "lervo-schema://roles/organization-decision/v1",
    pathTemplate: ".lervo/generated/organization/{runId}.json",
    citationsRequired: true,
    presentation: { audience: "machine", writingPolicyId: null },
  },
  verification: { suiteIds: ["role.organization.decision"], failureDisposition: "require_review" },
  handoff: {
    allowedRoleIds: ["developer", "designer", "ideation", "marketer", "researcher", "writer"],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function ceoRoleDefinition() {
  return defineRole(profile, [
    {
      checkId: "organization.decision-schema",
      category: "artifact_schema",
      method: "project_verification",
      requirement:
        "The organization decision must preserve team, authority, budget, delegation, and approval coordinates.",
      verificationSuiteId: "role.organization.decision",
      evidenceRequired: true,
    },
  ]);
}
