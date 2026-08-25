import type { RoleProfile } from "@lervo/schemas";

export function createRemoteDeveloperRole(
  verificationSuiteIds: readonly string[],
  skillIds: readonly string[] = [],
): RoleProfile {
  return {
    schemaVersion: 1,
    roleId: "developer",
    name: "Remote Developer",
    description:
      "Changes files within signed approval scope through path-specific managed provider turns.",
    requestTypes: ["implementation"],
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
    defaultSkills: [...skillIds],
    outputContract: {
      artifactKind: "source_code",
      schemaRef: "lervo-schema://run/source-code/v1",
      pathTemplate: "{expectedPath}",
      citationsRequired: false,
      presentation: { audience: "machine", writingPolicyId: null },
    },
    verification: {
      suiteIds: [...verificationSuiteIds],
      failureDisposition: "fail_run",
    },
    handoff: {
      allowedRoleIds: [],
      evidenceLinksRequired: true,
      sharedContextRequired: true,
    },
  };
}
