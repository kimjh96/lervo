/**
 * The results of the Lervo application commands that the interface sends with
 * `application.command` and the core answers on the core link. The session host validates a
 * result against its command's schema before it forwards `application.result`. Results stay open
 * to new properties, so a newer core can add one without breaking an older session host.
 */

import {
  type ProjectAddResult,
  projectAddResultSchema,
  type ProjectMarkClearResult,
  projectMarkClearResultSchema,
  type ProjectMarkReadResult,
  projectMarkReadResultSchema,
  type ProjectMarkSetResult,
  projectMarkSetResultSchema,
  type ProjectRenameResult,
  projectRenameResultSchema,
  type ProjectsLocationResult,
  projectsLocationResultSchema,
  type ProjectUnregisterResult,
  projectUnregisterResultSchema,
} from "./application-project-results.js";
import {
  type AgentHireResult,
  agentHireResultSchema,
  type AgentModelResult,
  agentModelResultSchema,
  type AgentRenameResult,
  agentRenameResultSchema,
  type AgentStatusResult,
  agentStatusResultSchema,
  type AgentMarkSetResult,
  agentMarkSetResultSchema,
  type AgentMarkClearResult,
  agentMarkClearResultSchema,
  type AgentMarkReadResult,
  agentMarkReadResultSchema,
  type AgentContextResult,
  agentContextResultSchema,
  type AgentsListResult,
  agentsListResultSchema,
} from "./application-agent-results.js";
import {
  agentRoleResultSchema,
  roleAddResultSchema,
  roleEditResultSchema,
  roleRemoveResultSchema,
  type AgentRoleResult,
  type RoleAddResult,
  type RoleEditResult,
  type RoleRemoveResult,
} from "./application-role-results.js";
import {
  roomJoinResultSchema,
  roomAnswersResultSchema,
  roomRouteResultSchema,
  type RoomJoinResult,
  type RoomAnswersResult,
  type RoomRouteResult,
} from "./application-room-results.js";
import { turnSummaryResultSchema, type TurnSummaryResult } from "./application-turn-results.js";
import {
  workspaceListResultSchema,
  repositoryListResultSchema,
  providerListResultSchema,
  workspaceRetireResultSchema,
  workspaceRenameResultSchema,
  workspacePinResultSchema,
  workspaceStartResultSchema,
  type WorkspaceListResult,
  type RepositoryListResult,
  type ProviderListResult,
  type WorkspaceRetireResult,
  type WorkspaceRenameResult,
  type WorkspacePinResult,
  type WorkspaceStartResult,
} from "./application-workspace-results.js";

/** The application commands the core link carries, in the order the core lists them. */
export const applicationCommandNames = [
  "workspace.start",
  "workspace.list",
  "repository.list",
  "provider.list",
  "workspace.retire",
  "workspace.rename",
  "workspace.pin",
  "turn.summary",
  "project.add",
  "project.rename",
  "project.mark.set",
  "project.mark.clear",
  "project.mark.read",
  "project.unregister",
  "projects.location",
  "agents.list",
  "agent.hire",
  "agent.model",
  "agent.rename",
  "agent.status",
  "agent.mark.set",
  "agent.mark.clear",
  "agent.mark.read",
  "agent.context",
  "agent.role",
  "role.add",
  "role.edit",
  "role.remove",
  "room.join",
  "room.route",
  "room.answers",
] as const;

/** Commands every core answers. Any other command is sent only to a core that advertises it. */
export const baseApplicationCommandNames = [
  "workspace.start",
  "workspace.list",
  "repository.list",
] as const;

/** Each command's result schema. */
export const applicationResultSchemas = {
  "workspace.start": workspaceStartResultSchema,
  "workspace.list": workspaceListResultSchema,
  "repository.list": repositoryListResultSchema,
  "provider.list": providerListResultSchema,
  "workspace.retire": workspaceRetireResultSchema,
  "workspace.rename": workspaceRenameResultSchema,
  "workspace.pin": workspacePinResultSchema,
  "turn.summary": turnSummaryResultSchema,
  "project.add": projectAddResultSchema,
  "project.rename": projectRenameResultSchema,
  "project.mark.set": projectMarkSetResultSchema,
  "project.mark.clear": projectMarkClearResultSchema,
  "project.mark.read": projectMarkReadResultSchema,
  "project.unregister": projectUnregisterResultSchema,
  "projects.location": projectsLocationResultSchema,
  "agents.list": agentsListResultSchema,
  "agent.hire": agentHireResultSchema,
  "agent.model": agentModelResultSchema,
  "agent.rename": agentRenameResultSchema,
  "agent.status": agentStatusResultSchema,
  "agent.mark.set": agentMarkSetResultSchema,
  "agent.mark.clear": agentMarkClearResultSchema,
  "agent.mark.read": agentMarkReadResultSchema,
  "agent.context": agentContextResultSchema,
  "agent.role": agentRoleResultSchema,
  "role.add": roleAddResultSchema,
  "role.edit": roleEditResultSchema,
  "role.remove": roleRemoveResultSchema,
  "room.join": roomJoinResultSchema,
  "room.route": roomRouteResultSchema,
  "room.answers": roomAnswersResultSchema,
} as const;

export type ApplicationCommandName = (typeof applicationCommandNames)[number];

/** Each command's result type. */
export interface ApplicationResults {
  "workspace.start": WorkspaceStartResult;
  "workspace.list": WorkspaceListResult;
  "repository.list": RepositoryListResult;
  "provider.list": ProviderListResult;
  "workspace.retire": WorkspaceRetireResult;
  "workspace.rename": WorkspaceRenameResult;
  "workspace.pin": WorkspacePinResult;
  "turn.summary": TurnSummaryResult;
  "project.add": ProjectAddResult;
  "project.rename": ProjectRenameResult;
  "project.mark.set": ProjectMarkSetResult;
  "project.mark.clear": ProjectMarkClearResult;
  "project.mark.read": ProjectMarkReadResult;
  "project.unregister": ProjectUnregisterResult;
  "projects.location": ProjectsLocationResult;
  "agents.list": AgentsListResult;
  "agent.hire": AgentHireResult;
  "agent.model": AgentModelResult;
  "agent.rename": AgentRenameResult;
  "agent.status": AgentStatusResult;
  "agent.mark.set": AgentMarkSetResult;
  "agent.mark.clear": AgentMarkClearResult;
  "agent.mark.read": AgentMarkReadResult;
  "agent.context": AgentContextResult;
  "agent.role": AgentRoleResult;
  "role.add": RoleAddResult;
  "role.edit": RoleEditResult;
  "role.remove": RoleRemoveResult;
  "room.join": RoomJoinResult;
  "room.route": RoomRouteResult;
  "room.answers": RoomAnswersResult;
}
