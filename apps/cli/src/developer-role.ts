import type { RoleProfile } from "@lervo/schemas";

const developerRoleBase: RoleProfile = {
  schemaVersion: 1,
  roleId: "developer",
  name: "Developer",
  description: "저장소 지침을 읽고 선언된 한 파일을 변경합니다.",
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
    suiteIds: ["lervo.v0.not_run"],
    failureDisposition: "fail_run",
  },
  handoff: {
    allowedRoleIds: [],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

export function createDeveloperRole(skillIds: readonly string[]): RoleProfile {
  return { ...structuredClone(developerRoleBase), defaultSkills: [...skillIds] };
}
