/**
 * The results of the agent commands of the core link (Lervo ADE agents, "Core link"): a project's
 * agents with whether each is the team's or Lervo's own, the roles it can hire, and a hire.
 */
import type { FromSchema } from "json-schema-to-ts";

import { projectMarkOrNullSchema } from "./application-project-results.js";
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
    /** The image the owner chose, as a project's mark; null shows the first letter. */
    mark: projectMarkOrNullSchema,
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

/**
 * `agent.status`: the agent paused or working again. Only the reversible pair is offered here;
 * retiring stays a terminal command (Lervo ADE agents, "The profile").
 */
export const agentStatusResultSchema = {
  title: "AgentStatusResult",
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

/** `agent.mark.set`: the agent with the image the owner chose. */
export const agentMarkSetResultSchema = {
  title: "AgentMarkSetResult",
  type: "object",
  required: ["projectId", "agent"],
  properties: { projectId: identifierSchema, agent: agentSummarySchema },
} as const;

/** `agent.mark.clear`: the agent without an image, showing its first letter again. */
export const agentMarkClearResultSchema = {
  title: "AgentMarkClearResult",
  type: "object",
  required: ["projectId", "agent"],
  properties: { projectId: identifierSchema, agent: agentSummarySchema },
} as const;

/** `agent.mark.read`: the agent's image as Base64, or null when it has none. */
export const agentMarkReadResultSchema = {
  title: "AgentMarkReadResult",
  type: "object",
  required: ["projectId", "agentId", "image"],
  properties: {
    projectId: identifierSchema,
    agentId: identifierSchema,
    image: {
      anyOf: [
        {
          type: "object",
          required: ["sha256", "mediaType", "data"],
          properties: {
            sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
            mediaType: { enum: ["image/png", "image/jpeg", "image/webp"] },
            data: { type: "string", maxLength: 700_000 },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;

/** The most entries `agent.context` answers, newest first. */
export const MAXIMUM_LEARNED_ENTRIES = 50;
/** The most characters of one learned entry's summary that `agent.context` answers. */
export const MAXIMUM_LEARNED_SUMMARY_CHARACTERS = 4_000;
/** The most held paths `agent.context` lists; `pathsTotal` counts them all. */
export const MAXIMUM_HELD_PATHS = 100;

/**
 * `agent.context`: what the agent has learned, from its promoted context entries that are still
 * active, newest first (Lervo ADE agents, "The profile"). A restricted entry keeps its summary to
 * the agent's own sessions, so its `summary` is null here.
 */
export const agentContextResultSchema = {
  title: "AgentContextResult",
  type: "object",
  required: ["projectId", "agentId", "entries"],
  properties: {
    projectId: identifierSchema,
    agentId: identifierSchema,
    entries: {
      type: "array",
      maxItems: MAXIMUM_LEARNED_ENTRIES,
      items: {
        type: "object",
        required: ["entryId", "layer", "kind", "subject", "observedAt", "summary"],
        properties: {
          entryId: { type: "string", maxLength: 80 },
          layer: { enum: ["work", "relationship", "expertise"] },
          kind: { type: "string", maxLength: 64 },
          subject: { type: "string", maxLength: 160 },
          observedAt: { type: "string", maxLength: 40 },
          summary: {
            anyOf: [
              { type: "string", maxLength: MAXIMUM_LEARNED_SUMMARY_CHARACTERS },
              { type: "null" },
            ],
          },
        },
      },
    },
    /**
     * The repository paths the agent holds under a live write lease, sorted, as its
     * conversations' claims and its other assignments widened them (Lervo ADE agents, "The
     * profile"). Absent from a core that does not read leases.
     */
    paths: {
      type: "array",
      maxItems: MAXIMUM_HELD_PATHS,
      items: { type: "string", minLength: 1, maxLength: 1024 },
    },
    pathsTotal: { type: "integer", minimum: 0 },
    /**
     * The paths the conversations the agent leads changed and have not sealed yet, sorted, as
     * their latest reconciliation recorded them; held for conflicts, though not leased. Absent
     * from a core that does not record changed paths.
     */
    changedPaths: {
      type: "array",
      maxItems: MAXIMUM_HELD_PATHS,
      items: { type: "string", minLength: 1, maxLength: 1024 },
    },
    changedPathsTotal: { type: "integer", minimum: 0 },
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
export type AgentModelResult = FromSchema<typeof agentModelResultSchema>;
export type AgentRenameResult = FromSchema<typeof agentRenameResultSchema>;
export type AgentModelChoice = FromSchema<typeof agentModelChoiceSchema>;
export type AgentStatusResult = FromSchema<typeof agentStatusResultSchema>;
export type AgentMarkSetResult = FromSchema<typeof agentMarkSetResultSchema>;
export type AgentMarkClearResult = FromSchema<typeof agentMarkClearResultSchema>;
export type AgentMarkReadResult = FromSchema<typeof agentMarkReadResultSchema>;
export type AgentContextResult = FromSchema<typeof agentContextResultSchema>;
