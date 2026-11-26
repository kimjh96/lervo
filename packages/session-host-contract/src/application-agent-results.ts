/**
 * The results of the agent commands of the core link (Lervo ADE agents, "Core link"): a project's
 * agents with whether each is the team's or Lervo's own, the roles it can hire, and a hire.
 */
import type { FromSchema } from "json-schema-to-ts";

import { identifierSchema } from "./primitives.js";

const roleIdSchema = { type: "string", minLength: 1, maxLength: 64 } as const;

/**
 * The model and effort an agent's sessions run with (ADR-0647): a tier of the provider's line-up,
 * named for the interface, and whether its role or the owner chose them.
 */
export const agentModelSchema = {
  title: "AgentModel",
  type: "object",
  required: ["tier", "effort", "source"],
  properties: {
    tier: { enum: ["frontier", "strong", "balanced", "fast"] },
    effort: { enum: ["low", "medium", "high", "xhigh", "max"] },
    source: { enum: ["role", "owner"] },
    /** The provider's name for the tier's model, such as "Opus"; absent when it names none. */
    displayName: { type: "string", minLength: 1, maxLength: 40 },
  },
} as const;

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
    /** A team agent's model; Lervo's own agents run under Lervo's model routes and have none. */
    model: agentModelSchema,
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

/** One model a team agent can run on, as the agent's profile offers it (ADR-0647). */
export const agentModelChoiceSchema = {
  title: "AgentModelChoice",
  type: "object",
  required: ["tier", "displayName"],
  properties: {
    tier: { enum: ["frontier", "strong", "balanced", "fast"] },
    displayName: { type: "string", minLength: 1, maxLength: 40 },
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
    /**
     * The models a team agent can run on, most capable first; absent when the provider names
     * none, and its own default runs.
     */
    models: { type: "array", maxItems: 8, items: agentModelChoiceSchema },
  },
} as const;

/** `agent.model`: the agent with the model and effort the owner chose. */
export const agentModelResultSchema = {
  title: "AgentModelResult",
  type: "object",
  required: ["projectId", "agent"],
  properties: { projectId: identifierSchema, agent: agentSummarySchema },
} as const;

/** `agent.rename`: the agent with the name the owner gave it. */
export const agentRenameResultSchema = {
  title: "AgentRenameResult",
  type: "object",
  required: ["projectId", "agent"],
  properties: { projectId: identifierSchema, agent: agentSummarySchema },
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
export type AgentModelResult = FromSchema<typeof agentModelResultSchema>;
export type AgentRenameResult = FromSchema<typeof agentRenameResultSchema>;
export type AgentModelChoice = FromSchema<typeof agentModelChoiceSchema>;
