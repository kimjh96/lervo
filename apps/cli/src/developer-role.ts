import type { RoleProfile } from "@lervo/schemas";

export const developerResultProtocol = [
  "In the final response, use natural English complete sentences without a heading or list.",
  "State what changed, its effect, and the next action. If no action remains, state that no further action is needed.",
].join(" ");

const developerRoleBase: RoleProfile = {
  schemaVersion: 1,
  roleId: "developer",
  name: "Developer",
  description: `Read repository instructions and modify the single declared file. ${developerResultProtocol}`,
  requestTypes: ["implementation"],
  requiredInputs: [],
  contextPolicy: {
    requiredDocumentRuleIds: ["repository.instructions"],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow",
    "filesystem.write": "allow",
    "shell.execute": "allow",
    "network.access": "deny",
    "external.message": "deny",
    deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "source_code",
    schemaRef: "lervo-schema://run/source-code/v1",
    pathTemplate: "{expectedPath}",
    citationsRequired: false,
    presentation: { audience: "machine", writingPolicyId: null },
  },
  verification: {
    suiteIds: ["project.default"],
    failureDisposition: "fail_run",
  },
  handoff: {
    allowedRoleIds: [],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function createDeveloperRole(
  skillIds: readonly string[],
  verificationSuiteIds: readonly string[] = developerRoleBase.verification.suiteIds,
): RoleProfile {
  const role = structuredClone(developerRoleBase);
  role.defaultSkills = [...skillIds];
  role.verification.suiteIds = [...verificationSuiteIds];
  return role;
}

export function createDeveloperTurnInstructions(task: string): string {
  return [
    task,
    "",
    "Lervo managed result protocol:",
    developerResultProtocol,
  ].join("\n");
}
