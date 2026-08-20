import type { RoleDefinition } from "./types.js";
import { designerRoleDefinition } from "./profiles/designer.js";
import { marketerRoleDefinition } from "./profiles/marketer.js";
import { researcherRoleDefinition } from "./profiles/researcher.js";

const factories = {
  designer: designerRoleDefinition,
  marketer: marketerRoleDefinition,
  researcher: researcherRoleDefinition,
} as const;

export type BuiltInRoleId = keyof typeof factories;

export function getBuiltInRoleDefinition(roleId: BuiltInRoleId): RoleDefinition {
  return factories[roleId]();
}

export function listBuiltInRoleDefinitions(): RoleDefinition[] {
  return (Object.keys(factories) as BuiltInRoleId[]).map((roleId) => factories[roleId]());
}
