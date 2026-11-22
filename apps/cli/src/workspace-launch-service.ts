// `lervo workspace start` and `open` as services, for the CLI and the resident process alike.
import { randomBytes, randomUUID } from "node:crypto";

import type { HostedConversationMode, HostedLaunch } from "@lervo/adapter-contract";
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import { CommandFailure } from "./command-error-output.js";
import {
  hostedLaunchRecordsPath,
  latestHostedLaunch,
  launchArgumentDigest,
  recordHostedLaunch,
} from "./hosted-launch-records.js";
import { resolveHostedSessionAdapter } from "./hosted-session-adapters.js";
import { startWorkspace, type WorkspaceStartResult } from "./workspace-start.js";
import {
  defaultBranchCommit,
  gitWorkspaceEffects,
  startWorkstreamIn,
  worktreeOfBranch,
} from "./workspace-start-effects.js";

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function parseConversationMode(value: unknown): HostedConversationMode {
  if (value === undefined || value === "native" || value === "cli") return value ?? "native";
  throw new CommandFailure("launch_intent_invalid", "The mode must be native or cli.");
}

async function registeredRepository(projectId: string) {
  return resolveRegisteredRepository({ registryPath: defaultRepositoryRegistryPath(), projectId });
}

export interface WorkspaceStartOptions {
  readonly instruction: string;
  readonly repository: string;
  readonly provider?: string;
  readonly mode?: HostedConversationMode;
  readonly model?: string;
}

/** Creates the workspace and prepares its hosted launch; failures are `CommandFailure`s. */
export async function startWorkspaceFromInstruction(
  options: WorkspaceStartOptions,
): Promise<WorkspaceStartResult> {
  const repository = await registeredRepository(options.repository);
  const adapter = await resolveHostedSessionAdapter(options.provider ?? "claude");
  return startWorkspace(
    {
      instruction: options.instruction,
      mode: options.mode ?? "native",
      repositoryRoot: repository.repositoryRoot,
      projectId: repository.projectId,
      baseCommit: await defaultBranchCommit(repository.repositoryRoot),
      workspaceId: `wsp_${hex(12)}`,
      sessionId: randomUUID(),
      suffix: hex(3),
      ...(options.model === undefined ? {} : { model: options.model }),
    },
    {
      adapter,
      ...gitWorkspaceEffects(),
      startWorkstream: startWorkstreamIn,
      recordLaunch: (record) => recordHostedLaunch(hostedLaunchRecordsPath(), record),
      now: () => new Date(),
    },
  );
}

export interface WorkspaceOpenResult {
  schemaVersion: 1;
  status: "opened";
  workspaceId: string;
  sessionId: string;
  provider: string;
  resumed: boolean;
  launch: HostedLaunch;
}

/**
 * Prepares the launch that continues a workspace's hosted session: a resume where the provider
 * supports one, otherwise a new session in the same worktree.
 */
export async function openWorkspace(
  workspaceId: string,
  requestedMode?: HostedConversationMode,
): Promise<WorkspaceOpenResult> {
  const path = hostedLaunchRecordsPath();
  const previous = await latestHostedLaunch(path, workspaceId);
  if (previous === null)
    throw new CommandFailure("workspace_not_found", "No hosted launch exists for the workspace.");
  const repository = await registeredRepository(previous.projectId);
  const workingDirectory = await worktreeOfBranch(repository.repositoryRoot, previous.branch);
  if (workingDirectory === null)
    throw new CommandFailure("workspace_not_found", "The workspace's worktree no longer exists.");
  const adapter = await resolveHostedSessionAdapter(previous.provider);
  const mode = requestedMode ?? previous.conversationMode;
  const resume = adapter.capabilities.resume;
  const sessionId = resume ? previous.sessionId : randomUUID();
  const launch = adapter.prepareLaunch({
    sessionId,
    mode,
    workingDirectory,
    start: resume ? { kind: "resume" } : { kind: "new", instruction: "Continue." },
  });
  await recordHostedLaunch(path, {
    ...previous,
    sessionId,
    conversationMode: mode,
    argumentDigest: launchArgumentDigest(launch),
    preparedAt: new Date().toISOString(),
  });
  return {
    schemaVersion: 1,
    status: "opened",
    workspaceId: previous.workspaceId,
    sessionId,
    provider: adapter.provider,
    resumed: resume,
    launch,
  };
}
