// `workspace.list` and `repository.list`: what the ADE's start screen and workspace list show.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readProjectProfile } from "@lervo/project";
import {
  defaultRepositoryRegistryPath,
  listRegisteredRepositories,
} from "@lervo/repository-registry";
import { readPrivateJsonFile } from "@lervo/repository-knowledge-runtime";

import { type HostedLaunchRecord, hostedLaunchRecordsPath } from "./hosted-launch-records.js";
import { hostedProviderModes } from "./hosted-session-adapters.js";
import { worktreesByBranch } from "./workspace-start-effects.js";

/** Workspaces in one answer, newest first. */
export const MAX_LISTED_WORKSPACES = 100;
const MAX_RECORD_FILE_BYTES = 1024 * 1024;
const MAX_WORKSTREAM_BYTES = 64 * 1024;

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
  /** The writing agent and every agent the conversation started with, when it started with any. */
  agentId?: string;
  participants?: string[];
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

async function latestRecords(): Promise<HostedLaunchRecord[]> {
  const file = await readPrivateJsonFile(hostedLaunchRecordsPath(), MAX_RECORD_FILE_BYTES);
  if (file.status !== "read") return [];
  const records = (file.value as { records?: HostedLaunchRecord[] }).records ?? [];
  const latest = new Map<string, HostedLaunchRecord>();
  for (const record of records) latest.set(record.workspaceId, record);
  return [...latest.values()].sort((left, right) =>
    right.preparedAt.localeCompare(left.preparedAt),
  );
}

/** The workstream title in a worktree, or null when its state is unreadable. */
async function workstreamTitle(worktree: string): Promise<string | null> {
  try {
    const path = resolve(worktree, ".lervo/state/workstreams/current.json");
    const content = await readFile(path, "utf8");
    if (content.length > MAX_WORKSTREAM_BYTES) return null;
    const title = (JSON.parse(content) as { title?: unknown }).title;
    return typeof title === "string" ? title : null;
  } catch {
    return null;
  }
}

/**
 * The workspaces with a hosted launch on this host whose worktree still exists, newest first. It
 * reads one worktree listing per repository and one workstream file per workspace.
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
  for (const record of await latestRecords()) {
    if (workspaces.length >= MAX_LISTED_WORKSPACES) break;
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
      title: await workstreamTitle(worktree),
      provider: record.provider,
      conversationMode: record.conversationMode,
      conversationModes: hostedProviderModes(record.provider) ?? [record.conversationMode],
      sessionId: record.sessionId,
      preparedAt: record.preparedAt,
      ...(record.agentId === undefined ? {} : { agentId: record.agentId }),
      ...(record.participants === undefined ? {} : { participants: record.participants }),
    });
  }
  return { workspaces };
}
