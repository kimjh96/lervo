// `workspace.list` and `repository.list`: what the ADE's start screen and workspace list show.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
}

/** The host's registered repositories, by name. */
export async function listRepositories(): Promise<{ repositories: RepositorySummary[] }> {
  const registrations = await listRegisteredRepositories(defaultRepositoryRegistryPath());
  return {
    repositories: registrations
      .map(({ projectId, name }) => ({ projectId, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
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
    });
  }
  return { workspaces };
}
