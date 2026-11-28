/**
 * The results of the role commands of the core link (Lervo ADE agents, "Roles"; ADR-0662): a
 * project's own roles added, edited, and removed, and an agent moved to another role.
 */
import type { FromSchema } from "json-schema-to-ts";

import { agentSummarySchema, hireableRoleSchema } from "./application-agent-results.js";
import { identifierSchema } from "./primitives.js";

/** `role.add`: the project role the core added, as the hire menu lists it. */
export const roleAddResultSchema = {
  title: "RoleAddResult",
  type: "object",
  required: ["projectId", "role"],
  properties: { projectId: identifierSchema, role: hireableRoleSchema },
} as const;

/** `role.edit`: the role at its new version, and whether the edit changed anything. */
export const roleEditResultSchema = {
  title: "RoleEditResult",
  type: "object",
  required: ["projectId", "role", "changed"],
  properties: {
    projectId: identifierSchema,
    role: hireableRoleSchema,
    changed: { type: "boolean" },
  },
} as const;

/** `role.remove`: the ID of the project role the core removed. */
export const roleRemoveResultSchema = {
  title: "RoleRemoveResult",
  type: "object",
  required: ["projectId", "roleId"],
  properties: {
    projectId: identifierSchema,
    roleId: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

/** `agent.role`: the agent at its new role, working again if it was. */
export const agentRoleResultSchema = {
  title: "AgentRoleResult",
  type: "object",
  required: ["projectId", "agent"],
  properties: { projectId: identifierSchema, agent: agentSummarySchema },
} as const;

export type RoleAddResult = FromSchema<typeof roleAddResultSchema>;
export type RoleEditResult = FromSchema<typeof roleEditResultSchema>;
export type RoleRemoveResult = FromSchema<typeof roleRemoveResultSchema>;
export type AgentRoleResult = FromSchema<typeof agentRoleResultSchema>;
