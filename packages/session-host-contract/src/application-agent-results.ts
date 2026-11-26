/**
 * The results of the agent commands of the core link (Lervo ADE agents, "Core link"): a project's
 * agents with whether each is the team's or Lervo's own, the roles it can hire, and a hire.
 */
import type { FromSchema } from "json-schema-to-ts";

import { identifierSchema } from "./primitives.js";

const roleIdSchema = { type: "string", minLength: 1, maxLength: 64 } as const;

/** One agent of a project, as the sidebar shows it. */
export const agentSummarySchema = {
  title: "AgentSummary",
  type: "object",
  required: ["agentId", "displayName", "roleId", "roleName", "status", "origin", "revision"],
  properties: {
    agentId: identifierSchema,
    displayName: { type: "string", minLength: 1, maxLength: 40 },
    roleId: roleIdSchema,
    roleName: { type: "string", minLength: 1, maxLength: 100 },
    status: { enum: ["active", "suspended"] },
    origin: { enum: ["team", "lervo"] },
    provider: { type: "string", maxLength: 32 },
    parentAgentId: { anyOf: [identifierSchema, { type: "null" }] },
    revision: { type: "integer", minimum: 1 },
  },
} as const;

/** One role a project can hire, with the one-line description its hire menu shows. */
export const hireableRoleSchema = {
  title: "HireableRole",
  type: "object",
  required: ["roleId", "name", "description", "source"],
  properties: {
    roleId: roleIdSchema,
    name: { type: "string", minLength: 1, maxLength: 100 },
    description: { type: "string", maxLength: 1000 },
    source: { enum: ["built_in", "repository"] },
  },
} as const;

/** `agents.list`: the project's active and suspended agents and the roles it can hire. */
export const agentsListResultSchema = {
  title: "AgentsListResult",
  type: "object",
  required: ["projectId", "agents", "roles"],
  properties: {
    projectId: identifierSchema,
    agents: { type: "array", maxItems: 256, items: agentSummarySchema },
    roles: { type: "array", maxItems: 128, items: hireableRoleSchema },
  },
} as const;

/** `agent.hire`: the agent the core hired for the owner. */
export const agentHireResultSchema = {
  title: "AgentHireResult",
  type: "object",
  required: ["projectId", "agent"],
  properties: { projectId: identifierSchema, agent: agentSummarySchema },
} as const;

export type AgentSummary = FromSchema<typeof agentSummarySchema>;
export type HireableRole = FromSchema<typeof hireableRoleSchema>;
export type AgentsListResult = FromSchema<typeof agentsListResultSchema>;
export type AgentHireResult = FromSchema<typeof agentHireResultSchema>;
