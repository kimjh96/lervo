import { parseRepositoryRoleSource, type RepositoryRoleSource } from "./repository.js";

export function renderRepositoryRoleSource(source: RepositoryRoleSource): string {
  const parsed = parseRepositoryRoleSource(source, source.roleId);
  return `${JSON.stringify(
    {
      schemaVersion: parsed.schemaVersion,
      kind: parsed.kind,
      roleId: parsed.roleId,
      version: parsed.version,
      extends: parsed.extends,
      profile: parsed.profile,
      checks: parsed.checks,
    },
    null,
    2,
  )}\n`;
}
