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
     * The application commands this core answers. An older core omits it and answers only the
     * base commands.
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

/** Each command's result schema. */
export const applicationResultSchemas = {
  "workspace.start": workspaceStartResultSchema,
  "workspace.list": workspaceListResultSchema,
  "repository.list": repositoryListResultSchema,
  "provider.list": providerListResultSchema,
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

/** Each command's result type. */
export interface ApplicationResults {
  "workspace.start": WorkspaceStartResult;
  "workspace.list": WorkspaceListResult;
  "repository.list": RepositoryListResult;
  "provider.list": ProviderListResult;
}
