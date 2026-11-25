/**
 * The results of the Lervo application commands that the interface sends with
 * `application.command` and the core answers on the core link. The session host validates a
 * result against its command's schema before it forwards `application.result`. Results stay open
 * to new properties, so a newer core can add one without breaking an older session host.
 */
import type { FromSchema } from "json-schema-to-ts";

import { identifierSchema } from "./primitives.js";
import { conversationModeSchema } from "./session.js";

/** A provider's identifier, such as `claude`. The interface shows its display name instead. */
export const providerIdSchema = { type: "string", pattern: "^[a-z][a-z0-9-]{0,31}$" } as const;

/** The application commands the core link carries, in the order the core lists them. */
export const applicationCommandNames = [
  "workspace.start",
  "workspace.list",
  "repository.list",
  "provider.list",
  "workspace.retire",
  "turn.summary",
] as const;

/** Commands every core answers. Any other command is sent only to a core that advertises it. */
export const baseApplicationCommandNames = [
  "workspace.start",
  "workspace.list",
  "repository.list",
] as const;

const nameSchema = { type: "string", minLength: 1, maxLength: 256 } as const;
const timestampSchema = { type: "string", minLength: 1, maxLength: 64 } as const;

/** The conversation modes a provider offers, the native conversation first when it has one. */
export const conversationModesSchema = {
  type: "array",
  minItems: 1,
  maxItems: 2,
  uniqueItems: true,
  items: conversationModeSchema,
} as const;

export const workspaceSummarySchema = {
  title: "WorkspaceSummary",
  type: "object",
  required: [
    "workspaceId",
    "projectId",
    "repositoryName",
    "branch",
    "title",
    "provider",
    "conversationMode",
    "sessionId",
    "preparedAt",
  ],
  properties: {
    workspaceId: identifierSchema,
    projectId: identifierSchema,
    repositoryName: nameSchema,
    branch: nameSchema,
    /** The workstream title, or null when the worktree's state is unreadable. */
    title: { oneOf: [{ type: "string", maxLength: 1024 }, { type: "null" }] },
    provider: providerIdSchema,
    conversationMode: conversationModeSchema,
    /** The modes the workspace's provider offers. An older core omits it. */
    conversationModes: conversationModesSchema,
    sessionId: identifierSchema,
    preparedAt: timestampSchema,
  },
} as const;

/** `workspace.list`: the workspaces with a hosted launch on this host, newest first. */
export const workspaceListResultSchema = {
  title: "WorkspaceListResult",
  type: "object",
  required: ["workspaces"],
  properties: {
    workspaces: { type: "array", maxItems: 1000, items: workspaceSummarySchema },
    /**
     * The application commands this core answers, and the core-link requests it advertises, such
     * as `session.exited`. An older core omits it and answers only the base commands.
     */
    commands: {
      type: "array",
      maxItems: 64,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z]+(\\.[a-z_]+)+$", maxLength: 64 },
    },
  },
} as const;

export const repositorySummarySchema = {
  title: "RepositorySummary",
  type: "object",
  required: ["projectId", "name"],
  properties: { projectId: identifierSchema, name: nameSchema },
} as const;

/** `repository.list`: the host's registered repositories, by name. */
export const repositoryListResultSchema = {
  title: "RepositoryListResult",
  type: "object",
  required: ["repositories"],
  properties: {
    repositories: { type: "array", maxItems: 1000, items: repositorySummarySchema },
  },
} as const;

/**
 * Where a started workspace branched from (Lervo ADE sessions, "The workspace's base"), so the
 * interface can tell the user after the fact. Counts only; the commits stay on the host.
 */
export const workspaceStartBaseSchema = {
  title: "WorkspaceStartBase",
  type: "object",
  required: ["source", "upstream", "notice", "replayed", "skipped", "carried"],
  properties: {
    source: { enum: ["upstream", "local"] },
    upstream: { anyOf: [nameSchema, { type: "null" }] },
    // Open, so a newer CLI's notice never fails an older ADE's start. The CLI documents the known
    // ones: base_unresolved, no_upstream, fetch_failed, knowledge_state_unreadable, and
    // replay_incomplete.
    notice: { anyOf: [{ type: "string", pattern: "^[a-z_]{1,64}$" }, { type: "null" }] },
    replayed: { type: "integer", minimum: 0, maximum: 100_000 },
    skipped: { type: "integer", minimum: 0, maximum: 100_000 },
    carried: { type: "integer", minimum: 0, maximum: 100_000 },
  },
} as const;

/** `workspace.start`: the created workspace. The session host starts its session separately. */
export const workspaceStartResultSchema = {
  title: "WorkspaceStartResult",
  type: "object",
  required: ["workspaceId", "sessionId", "provider"],
  properties: {
    workspaceId: identifierSchema,
    workstreamId: identifierSchema,
    projectId: identifierSchema,
    branch: nameSchema,
    sessionId: identifierSchema,
    provider: providerIdSchema,
    base: workspaceStartBaseSchema,
  },
} as const;

/** What a provider's hosted-session adapter supports (the adapter contract's capabilities). */
export const providerCapabilitiesSchema = {
  title: "ProviderCapabilities",
  type: "object",
  required: [
    "nativeConversation",
    "sessionIdBinding",
    "hooks",
    "mcp",
    "systemPromptFile",
    "resume",
  ],
  properties: {
    nativeConversation: { type: "boolean" },
    sessionIdBinding: { type: "boolean" },
    hooks: { type: "boolean" },
    mcp: { type: "boolean" },
    systemPromptFile: { type: "boolean" },
    resume: { type: "boolean" },
  },
} as const;

export const providerSummarySchema = {
  title: "ProviderSummary",
  type: "object",
  required: [
    "provider",
    "displayName",
    "capabilities",
    "conversationModes",
    "preferredMode",
    "installed",
  ],
  properties: {
    provider: providerIdSchema,
    /** The provider's product name, such as "Claude Code". The interface shows it untranslated. */
    displayName: { type: "string", minLength: 1, maxLength: 64 },
    capabilities: providerCapabilitiesSchema,
    conversationModes: conversationModesSchema,
    preferredMode: conversationModeSchema,
    /** Whether the provider's CLI is installed where the core looks for it. */
    installed: { type: "boolean" },
  },
} as const;

/** `provider.list`: every admitted hosted provider, and the one the core starts by default. */
export const providerListResultSchema = {
  title: "ProviderListResult",
  type: "object",
  required: ["providers", "defaultProvider"],
  properties: {
    providers: { type: "array", minItems: 1, maxItems: 64, items: providerSummarySchema },
    defaultProvider: providerIdSchema,
  },
} as const;

/**
 * `workspace.retire`: what retiring a workspace removed. The core removes a clean worktree, and
 * the branch only when its commits are already on the default branch; it keeps everything else.
 */
export const workspaceRetireResultSchema = {
  title: "WorkspaceRetireResult",
  type: "object",
  required: ["workspaceId", "worktree", "branch"],
  properties: {
    workspaceId: identifierSchema,
    /** `absent` when the worktree was already gone. */
    worktree: { type: "string", enum: ["removed", "absent"] },
    /** `kept` when the branch holds commits the default branch lacks. */
    branch: { type: "string", enum: ["deleted", "kept", "absent"] },
  },
} as const;

const countSchema = { type: "integer", minimum: 0 } as const;

/**
 * One turn as the core recorded it (Lervo ADE sessions, "The turn summary"): what Lervo gave the
 * agent, what the agent's searches found and what it cited, what changed, and what the turn used.
 * Every field comes from the repository's records; a turn the core did not record is null.
 */
export const turnSummarySchema = {
  title: "TurnSummary",
  type: "object",
  required: ["given", "searched", "cited", "outcome"],
  properties: {
    /** Documents Lervo selected for the turn, and the workstream revision it gave. */
    given: {
      type: "object",
      required: ["documents"],
      properties: { documents: countSchema, workstreamRevision: countSchema },
    },
    /** Documents the agent's own Lervo searches found, with the first paths. */
    searched: {
      type: "object",
      required: ["documents", "paths"],
      properties: {
        documents: countSchema,
        paths: { type: "array", maxItems: 10, items: { type: "string", maxLength: 512 } },
      },
    },
    /** References to documents the agent's answer made, as Stop observed them. */
    cited: countSchema,
    outcome: {
      type: "object",
      required: ["repositoryChanged", "completion"],
      properties: {
        repositoryChanged: { type: "boolean" },
        changedPaths: countSchema,
        workstreamRevision: countSchema,
        /** `allowed`, `blocked`, or `not_checked`, as the turn's observation says. */
        completion: { type: "string", maxLength: 32 },
        /** How a turn without a Stop hook ended, such as `next_prompt`. */
        ending: { type: "string", maxLength: 32 },
      },
    },
    /** The provider-reported usage of the turn's results, with a list-price cost when known. */
    usage: {
      type: "object",
      required: ["inputTokens", "cachedInputTokens", "outputTokens"],
      properties: {
        inputTokens: countSchema,
        cachedInputTokens: countSchema,
        outputTokens: countSchema,
        costUsd: { type: "number", minimum: 0 },
      },
    },
  },
} as const;

/** `turn.summary`: each requested turn's summary, in the order asked, or null. */
export const turnSummaryResultSchema = {
  title: "TurnSummaryResult",
  type: "object",
  required: ["turns"],
  properties: {
    turns: {
      type: "array",
      maxItems: 20,
      items: { oneOf: [turnSummarySchema, { type: "null" }] },
    },
  },
} as const;

/** Each command's result schema. */
export const applicationResultSchemas = {
  "workspace.start": workspaceStartResultSchema,
  "workspace.list": workspaceListResultSchema,
  "repository.list": repositoryListResultSchema,
  "provider.list": providerListResultSchema,
  "workspace.retire": workspaceRetireResultSchema,
  "turn.summary": turnSummaryResultSchema,
} as const;

export type ApplicationCommandName = (typeof applicationCommandNames)[number];
export type WorkspaceSummary = FromSchema<typeof workspaceSummarySchema>;
export type WorkspaceListResult = FromSchema<typeof workspaceListResultSchema>;
export type RepositorySummary = FromSchema<typeof repositorySummarySchema>;
export type RepositoryListResult = FromSchema<typeof repositoryListResultSchema>;
export type WorkspaceStartResult = FromSchema<typeof workspaceStartResultSchema>;
export type ProviderCapabilities = FromSchema<typeof providerCapabilitiesSchema>;
export type ProviderSummary = FromSchema<typeof providerSummarySchema>;
export type ProviderListResult = FromSchema<typeof providerListResultSchema>;
export type WorkspaceRetireResult = FromSchema<typeof workspaceRetireResultSchema>;
export type TurnSummary = FromSchema<typeof turnSummarySchema>;
export type TurnSummaryResult = FromSchema<typeof turnSummaryResultSchema>;

/** Each command's result type. */
export interface ApplicationResults {
  "workspace.start": WorkspaceStartResult;
  "workspace.list": WorkspaceListResult;
  "repository.list": RepositoryListResult;
  "provider.list": ProviderListResult;
  "workspace.retire": WorkspaceRetireResult;
  "turn.summary": TurnSummaryResult;
}
