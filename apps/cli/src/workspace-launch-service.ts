// `lervo workspace start` and `open` as services, for the CLI and the resident process alike.
import { randomBytes, randomUUID } from "node:crypto";

import {
  hasTranscriptReader,
  type HostedConversationMode,
  type HostedLaunch,
  type HostedSessionAdapter,
  preferredConversationMode,
} from "@lervo/adapter-contract";
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import { CommandFailure } from "./command-error-output.js";
import {
  hostedLaunchRecordsPath,
  hostedLaunchSessions,
  latestHostedLaunch,
  launchArgumentDigest,
  recordHostedLaunch,
  type HostedLaunchRecord,
} from "./hosted-launch-records.js";
import {
  launchPreparedEvent,
  recordHostedSessionEvents,
  type HostedSessionEvent,
  type HostedSessionEventOutcome,
} from "./hosted-session-events.js";
import {
  hostedSessionHooks,
  hostedSessionSettingsDirectory,
  pruneHostedSessionSettings,
  settingsFileDigest,
  writeHostedSessionSettings,
} from "./hosted-session-settings.js";
import { defaultHostedProvider, resolveHostedSessionAdapter } from "./hosted-session-adapters.js";
import { chooseWorkspaceBase, gitWorkspaceBase } from "./workspace-base.js";
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

/** The requested mode, or `undefined` when none was requested and the provider's preference applies. */
export function parseConversationMode(value: unknown): HostedConversationMode | undefined {
  if (value === undefined || value === "native" || value === "cli") return value;
  throw new CommandFailure("launch_intent_invalid", "The mode must be native or cli.");
}

async function registeredRepository(projectId: string) {
  return resolveRegisteredRepository({ registryPath: defaultRepositoryRegistryPath(), projectId });
}

/** Records the launch and drops the settings files of sessions that no record keeps. */
async function recordLaunch(record: HostedLaunchRecord): Promise<void> {
  const path = hostedLaunchRecordsPath();
  await recordHostedLaunch(path, record);
  await pruneHostedSessionSettings(
    hostedSessionSettingsDirectory(),
    await hostedLaunchSessions(path),
  );
}

/** Records hosted session events in the registered repository; a failure never stops a launch. */
async function recordEvents(
  repositoryRoot: string,
  events: readonly HostedSessionEvent[],
): Promise<HostedSessionEventOutcome | "unavailable"> {
  try {
    return await recordHostedSessionEvents(repositoryRoot, events);
  } catch {
    return "unavailable";
  }
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
  const adapter = await resolveHostedSessionAdapter(options.provider ?? defaultHostedProvider);
  const sessionId = randomUUID();
  const hooks = hostedSessionHooks(adapter, sessionId);
  return startWorkspace(
    {
      instruction: options.instruction,
      mode: options.mode ?? preferredConversationMode(adapter.capabilities),
      repositoryRoot: repository.repositoryRoot,
      projectId: repository.projectId,
      baseCommit: await defaultBranchCommit(repository.repositoryRoot),
      workspaceId: `wsp_${hex(12)}`,
      sessionId,
      suffix: hex(3),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(hooks === undefined ? {} : { hooks }),
    },
    {
      adapter,
      // New work starts from the fetched upstream tip, never the owner's possibly stale checkout.
      chooseBase: (fallback) =>
        chooseWorkspaceBase(gitWorkspaceBase(repository.repositoryRoot), fallback),
      ...gitWorkspaceEffects(),
      startWorkstream: startWorkstreamIn,
      recordLaunch,
      writeSettings: writeHostedSessionSettings,
      recordEvents: (events) => recordEvents(repository.repositoryRoot, events),
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
  /** Whether the provider's transcript of this session can be read for the native conversation. */
  transcript: boolean;
  launch: HostedLaunch;
  /** Whether the repository took the `launch_prepared` event (`hosted_events_inactive` otherwise). */
  hostedEvents: HostedSessionEventOutcome | "unavailable";
}

/** A workspace's latest hosted launch, its worktree, and its provider's adapter. */
export async function locateWorkspaceSession(workspaceId: string) {
  const path = hostedLaunchRecordsPath();
  const previous = await latestHostedLaunch(path, workspaceId);
  if (previous === null)
    throw new CommandFailure("workspace_not_found", "No hosted launch exists for the workspace.");
  const repository = await registeredRepository(previous.projectId);
  const workingDirectory = await worktreeOfBranch(repository.repositoryRoot, previous.branch);
  if (workingDirectory === null)
    throw new CommandFailure("workspace_not_found", "The workspace's worktree no longer exists.");
  const adapter: HostedSessionAdapter = await resolveHostedSessionAdapter(previous.provider);
  return { path, previous, workingDirectory, adapter, repositoryRoot: repository.repositoryRoot };
}

/**
 * Prepares the launch that continues a workspace's hosted session: a resume where the provider
 * supports one, otherwise a new session in the same worktree.
 */
export async function openWorkspace(
  workspaceId: string,
  requestedMode?: HostedConversationMode,
): Promise<WorkspaceOpenResult> {
  const { previous, workingDirectory, adapter, repositoryRoot } =
    await locateWorkspaceSession(workspaceId);
  const mode = requestedMode ?? previous.conversationMode;
  const resume = adapter.capabilities.resume;
  const sessionId = resume ? previous.sessionId : randomUUID();
  const hooks = hostedSessionHooks(adapter, sessionId);
  const launch = adapter.prepareLaunch({
    sessionId,
    mode,
    workingDirectory,
    start: resume ? { kind: "resume" } : { kind: "new", instruction: "Continue." },
    ...(hooks === undefined ? {} : { hooks }),
  });
  if (launch.settingsFile !== null) await writeHostedSessionSettings(launch.settingsFile);
  const record: HostedLaunchRecord = {
    ...previous,
    sessionId,
    conversationMode: mode,
    argumentDigest: launchArgumentDigest(launch),
    settingsDigest: launch.settingsFile === null ? null : settingsFileDigest(launch.settingsFile),
    preparedAt: new Date().toISOString(),
  };
  await recordLaunch(record);
  const hostedEvents = await recordEvents(repositoryRoot, [launchPreparedEvent(record)]);
  return {
    schemaVersion: 1,
    status: "opened",
    workspaceId: previous.workspaceId,
    sessionId,
    provider: adapter.provider,
    resumed: resume,
    transcript: resume && hasTranscriptReader(adapter),
    launch,
    hostedEvents,
  };
}
