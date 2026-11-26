// The roles a project can hire, with the names the ADE and conversations show.
import { listRoleContracts, listRoleTemplates } from "@lervo/roles";

/**
 * The project's roles with their names and one-line descriptions, and a map from role ID to name.
 * A template role, such as the product owner, can be hired before the project has it: hiring
 * writes it (Lervo ADE projects, "The product-owner role template").
 */
export async function roleCatalog(root: string) {
  const roles: { roleId: string; name: string; description: string; source: string }[] = (
    await listRoleContracts(root)
  ).map((role) => ({
    roleId: role.roleId,
    name: role.definition.profile.name,
    description: role.definition.profile.description,
    source: role.sourceKind,
  }));
  for (const template of listRoleTemplates())
    if (!roles.some((role) => role.roleId === template.roleId))
      roles.push({ ...template, source: "repository" });
  return { roles, names: new Map(roles.map((role) => [role.roleId, role.name])) };
}
