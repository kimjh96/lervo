import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { listBuiltInRoleDefinitions } from "./profiles.js";
import { parseRepositoryRoleSource } from "./repository-role-source.js";

/**
 * Repository roles the core writes into a project that lacks them, the first time the project
 * hires one (Lervo ADE projects, "The product-owner role template"). They are not built-in roles:
 * the core refuses a repository role whose ID duplicates a built-in one, so a built-in
 * `product-owner` would invalidate every repository that already wrote its own.
 */
const roleTemplates = {
  "product-owner": {
    schemaVersion: 1,
    kind: "lervo_repository_role",
    roleId: "product-owner",
    version: "1.0.0",
    extends: [{ roleId: "ceo", version: "1.0.0" }],
    profile: {
      name: "Product Owner",
      description:
        "Owns one repository-backed product team, prioritizes outcomes, hires and delegates bounded team agents, and reports decisions to the central executive under exact organization policy.",
      requestTypes: [
        "product.inspect",
        "product.prioritize",
        "product.plan",
        "agent.hire",
        "assignment.delegate",
        "deliberation.convene",
        "organization.coordinate",
      ],
    },
    checks: [],
  },
} as const;

export type RoleTemplateId = keyof typeof roleTemplates;

export function isRoleTemplateId(roleId: string): roleId is RoleTemplateId {
  return Object.hasOwn(roleTemplates, roleId);
}

/** The template roles' IDs, names, and descriptions, which a project can hire before it has them. */
export function listRoleTemplates(): { roleId: string; name: string; description: string }[] {
  return Object.values(roleTemplates).map((template) => ({
    roleId: template.roleId,
    name: template.profile.name,
    description: template.profile.description,
  }));
}

/**
 * Writes `.lervo/roles/<roleId>.json` from the core's template when the project has no such role
 * and the ID is a template. Returns what it did: `written`, `present` when the file exists, or
 * `not_template`. An existing file is never replaced.
 */
export async function ensureTemplateRole(
  repositoryRoot: string,
  roleId: string,
): Promise<"written" | "present" | "not_template"> {
  if (!isRoleTemplateId(roleId)) return "not_template";
  if (listBuiltInRoleDefinitions().some((definition) => definition.profile.roleId === roleId))
    return "not_template";
  const template = roleTemplates[roleId];
  // The template is checked the way any repository role source is, before it is written.
  parseRepositoryRoleSource(template, roleId);
  const path = resolve(repositoryRoot, ".lervo/roles", `${roleId}.json`);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(template, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    return "written";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "present";
    throw error;
  }
}
