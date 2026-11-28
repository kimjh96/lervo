// `workspace.list` and `repository.list`: what the ADE's start screen and workspace list show.

import { readProjectProfile } from "@lervo/project";
import {
  defaultRepositoryRegistryPath,
  listRegisteredRepositories,
} from "@lervo/repository-registry";
import { readPrivateJsonFile } from "@lervo/repository-knowledge-runtime";
import { conversationOrder } from "@lervo/session-host-contract";

import {
  type HostedConversationProfile,
  hostedConversationProfilesPath,
  readHostedConversationProfiles,
} from "./hosted-conversation-profiles.js";
import {
  conversationOf,
  type HostedLaunchRecord,
  hostedLaunchRecordsPath,
  isConversationLead,
  listedTime,
} from "./hosted-launch-records.js";
import { hostedProviderModes } from "./hosted-session-adapters.js";
import { worktreesByBranch } from "./workspace-start-effects.js";
import { workstreamTitle } from "./workstream-title.js";

/** Workspaces in one answer, newest first. */
export const MAX_LISTED_WORKSPACES = 100;
const MAX_RECORD_FILE_BYTES = 1024 * 1024;

export interface RepositorySummary {
  projectId: string;
  name: string;
}

export interface WorkspaceSummary {
  workspaceId: string;
  projectId: string;
  repositoryName: string;
  branch: string;
  title: string | null;
  provider: string;
  conversationMode: "native" | "cli";
  /** The modes the workspace's provider offers; only its last mode when no adapter admits it. */
  conversationModes: ("native" | "cli")[];
  sessionId: string;
  preparedAt: string;
  /** The writing agent, and every agent of the conversation: those it started with, then joiners. */
  agentId?: string;
  participants?: string[];
  /** Each participant's session, the lead's first (Lervo ADE rooms). */
  sessions?: { agentId: string; sessionId: string; access: "write" | "read" }[];
  /** The latest activity the list orders by. */
  activeAt: string;
  /** When the owner pinned the conversation (Lervo ADE sessions, "Renaming and pinning"). */
  pinnedAt?: string;
}

/**
 * A workspace's lead record, the newest record of each agent in it, and its last activity: the
 * latest time any of its records places it in the list, so a reopen never moves it down.
 */
interface ListedWorkspace {
  lead: HostedLaunchRecord;
  agents: Map<string, HostedLaunchRecord>;
  activeAt: string;
  /** What the owner set for the conversation: its title and pin. */
  profile?: HostedConversationProfile;
  pinnedAt?: string;
}

/** The host's registered repositories, by name. */
/**
 * The registered repositories with their profiles: display name and mark, and this host's root,
 * which the interface uses only to show the folder (Lervo ADE projects, "Core link").
 */
export async function listRepositories(): Promise<{ repositories: RepositorySummary[] }> {
  const registrations = await listRegisteredRepositories(defaultRepositoryRegistryPath());
  const repositories = await Promise.all(
    registrations.map(async ({ projectId, name, repositoryRoot }) => {
      const read = await readProjectProfile(repositoryRoot).catch(() => ({
        state: "absent" as const,
      }));
      const profile = read.state === "present" ? read.profile : null;
      return {
        projectId,
        name,
        displayName: profile?.displayName ?? name,
        mark: profile?.mark ?? null,
        root: repositoryRoot,
      };
    }),
  );
  return {
    repositories: repositories.sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    ),
  };
}

async function latestRecords(): Promise<ListedWorkspace[]> {
  const file = await readPrivateJsonFile(hostedLaunchRecordsPath(), MAX_RECORD_FILE_BYTES);
  if (file.status !== "read") return [];
  const records = (file.value as { records?: HostedLaunchRecord[] }).records ?? [];
  const listed = new Map<string, ListedWorkspace>();
  for (const record of records) {
    // A member's record belongs to its conversation, never lists on its own (ADR-0661).
    const conversation = conversationOf(record);
    const known = listed.get(conversation);
    // Only the lead's record leads; the conversation lists once its lead's record is read.
    const lead = isConversationLead(record, conversation) ? record : known?.lead;
    if (lead === undefined) continue;
    const agents = known?.agents ?? new Map<string, HostedLaunchRecord>();
    if (record.agentId !== undefined) agents.set(record.agentId, record);
    const listedAt = listedTime(record);
    const activeAt = known === undefined || listedAt > known.activeAt ? listedAt : known.activeAt;
    listed.set(conversation, { lead, agents, activeAt });
  }
  return [...listed.values()].sort((left, right) => right.activeAt.localeCompare(left.activeAt));
}

/** The conversation's agents and their sessions: the lead first, then those who joined. */
function roomOf(workspace: ListedWorkspace): Pick<WorkspaceSummary, "participants" | "sessions"> {
  const joined = [...workspace.agents.values()].filter(
    (record) => !isConversationLead(record, workspace.lead.workspaceId),
  );
  const started = workspace.lead.participants ?? [];
  const participants = [
    ...started,
    ...joined.map((record) => record.agentId as string).filter((id) => !started.includes(id)),
  ];
  const lead = workspace.lead.agentId;
  const sessions = [
    ...(lead === undefined
      ? []
      : [{ agentId: lead, sessionId: workspace.lead.sessionId, access: "write" as const }]),
    // A member writes in its own workspace (ADR-0661); an agent that joined before it reads.
    ...joined.map((record) => ({
      agentId: record.agentId as string,
      sessionId: record.sessionId,
      access: record.access === "read" ? ("read" as const) : ("write" as const),
    })),
  ];
  return {
    ...(participants.length === 0 ? {} : { participants }),
    ...(sessions.length === 0 ? {} : { sessions }),
  };
}

/**
 * The listed workspaces in the list's order: pinned first, then latest activity first, so the
 * bound never drops a pinned conversation.
 */
async function listedInOrder(): Promise<ListedWorkspace[]> {
  const profiles = await readHostedConversationProfiles(hostedConversationProfilesPath());
  return conversationOrder(
    (await latestRecords()).map((listed) => {
      const profile = profiles.get(listed.lead.workspaceId);
      return profile === undefined
        ? listed
        : {
            ...listed,
            profile,
            ...(profile.pinnedAt === undefined ? {} : { pinnedAt: profile.pinnedAt }),
          };
    }),
  );
}

/**
 * The workspaces with a hosted launch on this host whose worktree still exists, pinned first and
 * then newest first. It reads one worktree listing per repository and one workstream file per
 * workspace whose owner gave it no title.
 */
export async function listWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }> {
  const registrations = new Map(
    (await listRegisteredRepositories(defaultRepositoryRegistryPath())).map((registration) => [
      registration.projectId,
      registration,
    ]),
  );
  const worktrees = new Map<string, Promise<Map<string, string>>>();
  const workspaces: WorkspaceSummary[] = [];
  for (const listed of await listedInOrder()) {
    if (workspaces.length >= MAX_LISTED_WORKSPACES) break;
    const record = listed.lead;
    const repository = registrations.get(record.projectId);
    if (repository === undefined) continue;
    if (!worktrees.has(record.projectId))
      worktrees.set(record.projectId, worktreesByBranch(repository.repositoryRoot));
    const worktree = (await worktrees.get(record.projectId))?.get(record.branch);
    if (worktree === undefined) continue;
    workspaces.push({
      workspaceId: record.workspaceId,
      projectId: record.projectId,
      repositoryName: repository.name,
      branch: record.branch,
      title: listed.profile?.title ?? (await workstreamTitle(worktree)),
      provider: record.provider,
      conversationMode: record.conversationMode,
      conversationModes: hostedProviderModes(record.provider) ?? [record.conversationMode],
      sessionId: record.sessionId,
      preparedAt: record.preparedAt,
      ...(record.agentId === undefined ? {} : { agentId: record.agentId }),
      ...roomOf(listed),
      activeAt: listed.activeAt,
      ...(listed.pinnedAt === undefined ? {} : { pinnedAt: listed.pinnedAt }),
    });
  }
  return { workspaces };
}
