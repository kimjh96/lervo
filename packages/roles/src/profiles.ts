import type { RoleDefinition } from "./types.js";
import { developerRoleDefinition } from "./profiles/developer.js";
import { designerRoleDefinition } from "./profiles/designer.js";
import { ideationRoleDefinition } from "./profiles/ideation.js";
import { marketerRoleDefinition } from "./profiles/marketer.js";
import { researcherRoleDefinition } from "./profiles/researcher.js";
import { writerRoleDefinition } from "./profiles/writer.js";

const factories = {
  developer: developerRoleDefinition,
  designer: designerRoleDefinition,
  ideation: ideationRoleDefinition,
  marketer: marketerRoleDefinition,
  researcher: researcherRoleDefinition,
  writer: writerRoleDefinition,
} as const;

export type BuiltInRoleId = keyof typeof factories;

export function getBuiltInRoleDefinition(roleId: BuiltInRoleId): RoleDefinition {
  return factories[roleId]();
}

export function listBuiltInRoleDefinitions(): RoleDefinition[] {
  return (Object.keys(factories) as BuiltInRoleId[]).map((roleId) => factories[roleId]());
}
