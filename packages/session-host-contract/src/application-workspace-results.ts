// The results of the core link's workspace, repository, and provider commands (Lervo ADE core
// link, "Application commands"): what a core answers about conversations, the repositories they
// start in, and the providers that run them.
import type { FromSchema } from "json-schema-to-ts";

import { projectMarkOrNullSchema } from "./application-project-results.js";
import { MAXIMUM_ROOM_AGENTS, roomSessionSchema } from "./application-room-results.js";
import { identifierSchema } from "./primitives.js";
import { conversationModeSchema } from "./session.js";

/** A provider's identifier, such as `claude`. The interface shows its display name instead. */
export const providerIdSchema = { type: "string", pattern: "^[a-z][a-z0-9-]{0,31}$" } as const;

const nameSchema = { type: "string", minLength: 1, maxLength: 256 } as const;
const rootSchema = { type: "string", minLength: 1, maxLength: 4096 } as const;
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
    /** The agent whose session this is, when the conversation started with agents. */
    agentId: identifierSchema,
    /** Every agent of the conversation, the writing one first, then those who joined. */
    participants: {
      type: "array",
      minItems: 1,
      maxItems: MAXIMUM_ROOM_AGENTS,
      items: identifierSchema,
    },
    /** Each participant's session, the lead's first (Lervo ADE rooms). An older core omits it. */
    sessions: { type: "array", maxItems: MAXIMUM_ROOM_AGENTS, items: roomSessionSchema },
  },
} as const;

/**
 * `workspace.list`: the workspaces with a hosted launch on this host, latest activity first: when
 * a conversation began or an agent joined it. Reopening a conversation does not move it.
 */
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

/**
 * One registered repository. `displayName` and `mark` come from its profile; `root` is this
 * host's folder for it, local operational data the interface uses only to show it in Finder.
 * Older cores omit all three.
 */
export const repositorySummarySchema = {
  title: "RepositorySummary",
  type: "object",
  required: ["projectId", "name"],
  properties: {
    projectId: identifierSchema,
    name: nameSchema,
    displayName: nameSchema,
    mark: projectMarkOrNullSchema,
    root: rootSchema,
  },
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

/**
 * Whether a started conversation claims its paths (Lervo ADE coordination): `active`, `inactive`,
 * or `unavailable`, each but the first with a code. Open, like the base's notice, so a newer
 * CLI's status or code never fails an older ADE's start. The CLI documents the known codes:
 * coordination_inactive, hook_runtime_stale, hub_coordinated_unsupported, and
 * coordination_unavailable.
 */
export const workspaceStartCoordinationSchema = {
  title: "WorkspaceStartCoordination",
  type: "object",
  required: ["status"],
  properties: {
    status: { type: "string", pattern: "^[a-z_]{1,64}$" },
    code: { type: "string", pattern: "^[a-z_]{1,64}$" },
    cause: { type: "string", pattern: "^[a-z0-9_]{1,64}$" },
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
    coordination: workspaceStartCoordinationSchema,
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
    /** Absent from a core before rooms (Lervo ADE rooms). */
    readAccess: { type: "boolean" },
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
    /** Whether someone is signed in to it; null when the core cannot tell. Older cores omit it. */
    signedIn: { anyOf: [{ type: "boolean" }, { type: "null" }] },
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

export type WorkspaceSummary = FromSchema<typeof workspaceSummarySchema>;
export type WorkspaceListResult = FromSchema<typeof workspaceListResultSchema>;
export type RepositorySummary = FromSchema<typeof repositorySummarySchema>;
export type RepositoryListResult = FromSchema<typeof repositoryListResultSchema>;
export type WorkspaceStartResult = FromSchema<typeof workspaceStartResultSchema>;
export type ProviderCapabilities = FromSchema<typeof providerCapabilitiesSchema>;
export type ProviderSummary = FromSchema<typeof providerSummarySchema>;
export type ProviderListResult = FromSchema<typeof providerListResultSchema>;
export type WorkspaceRetireResult = FromSchema<typeof workspaceRetireResultSchema>;
