// `lervo workspace start` and `open` as services, for the CLI and the resident process alike.
import { randomBytes, randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";

import {
  hasTranscriptReader,
  type HostedConversationMode,
  type HostedLaunch,
  type HostedSessionAdapter,
  preferredConversationMode,
} from "@lervo/adapter-contract";
import { readNewestConversationWorkspace } from "@lervo/agent-workforce";
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
  listedTime,
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
import { writeClaimHandler } from "./claim-handler-settings.js";
import { hostedTerminalHooks, writtenTerminalHooks } from "./hosted-terminal-hooks.js";
import { prefetchTerminalPromptContext } from "./terminal-knowledge-snapshot.js";
import { chooseWorkspaceBase, gitWorkspaceBase } from "./workspace-base.js";
import { runGit } from "./workspace-base-git.js";
import { insideRepository, invalidWorkspacesHome, workspacesHome } from "./workspaces-home.js";
import { startWorkspace, type WorkspaceStartResult } from "./workspace-start.js";
import { coordinateConversationWorkspace } from "./workspace-coordination.js";
import { conversationCoordinationPorts } from "./workspace-coordination-effects.js";
import { agentLaunchModel } from "./agent-launch-model.js";
import { resolveParticipants } from "./workspace-participants.js";
import { withSessionEnvironment } from "./hosted-session-environment.js";
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
export async function recordLaunch(record: HostedLaunchRecord): Promise<void> {
  const path = hostedLaunchRecordsPath();
  await recordHostedLaunch(path, record);
  await pruneHostedSessionSettings(
    hostedSessionSettingsDirectory(),
    await hostedLaunchSessions(path),
  );
}

/** Records hosted session events in the registered repository; a failure never stops a launch. */
export async function recordEvents(
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
  /** Agent IDs of the project's team; the first one's session writes. */
  readonly participants?: unknown;
  /** The conversation's title, instead of the instruction's first line. */
  readonly title?: string;
  /**
   * The team agent that started the conversation (Lervo ADE rooms, slice 2): its lead, or the
   * teammate that handed it to the lead (ADR-0657).
   */
  readonly startedBy?: string;
  /**
   * Whether the session host answers the agents' questions with choices. A provider that cannot
   * ask through its stream, or a conversation in the terminal, asks in prose.
   */
  readonly questions?: boolean;
}

/**
 * The commit new work starts from. A repository with no commit yet fails as
 * `repository_has_no_commit`, since a workspace is a worktree of a commit.
 */
async function baseCommitOf(root: string): Promise<string> {
  try {
    return await defaultBranchCommit(root);
  } catch (error) {
    const any = await runGit(root, ["rev-list", "-n", "1", "--all"]).catch(() => "unknown");
    if (any === "")
      throw new CommandFailure(
        "repository_has_no_commit",
        "The project has no commit yet. Commit its files, then start work.",
      );
    throw error;
  }
}

/** Creates the workspace and prepares its hosted launch; failures are `CommandFailure`s. */
export async function startWorkspaceFromInstruction(
  options: WorkspaceStartOptions,
): Promise<WorkspaceStartResult> {
  const repository = await registeredRepository(options.repository);
  const adapter = await resolveHostedSessionAdapter(options.provider ?? defaultHostedProvider);
  // The repository's folder under the home is where its workspaces go; it must lie outside every
  // repository, the owner's checkouts included, before anything changes.
  const home = workspacesHome();
  if (await insideRepository(resolve(home, basename(repository.repositoryRoot))))
    throw invalidWorkspacesHome(
      "Workspaces would land inside a Git repository. Set LERVO_WORKSPACES_HOME to a folder outside every repository.",
    );
  const participants = await resolveParticipants(repository.repositoryRoot, options.participants);
  // The agent that starts a conversation is an active teammate as well (ADR-0657).
  if (options.startedBy !== undefined)
    await resolveParticipants(repository.repositoryRoot, [options.startedBy]);
  // The writing agent's model and effort, unless the request named a model.
  const chosen =
    options.model === undefined
      ? await agentLaunchModel(repository.repositoryRoot, participants?.agentId, adapter)
      : { model: options.model };
  const sessionId = randomUUID();
  const hooks = hostedSessionHooks(adapter, sessionId);
  const mode = options.mode ?? preferredConversationMode(adapter.capabilities);
  const questions = options.questions === true && adapter.capabilities.questions;
  const git = gitWorkspaceEffects();
  return startWorkspace(
    {
      instruction: options.instruction,
      mode,
      ...(questions ? { questions } : {}),
      repositoryRoot: repository.repositoryRoot,
      projectId: repository.projectId,
      baseCommit: await baseCommitOf(repository.repositoryRoot),
      workspaceId: `wsp_${hex(12)}`,
      sessionId,
      suffix: hex(3),
      ...chosen,
      ...(hooks === undefined ? {} : { hooks }),
      ...(participants === undefined ? {} : { participants }),
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.startedBy === undefined ? {} : { startedBy: options.startedBy }),
    },
    {
      adapter,
      // New work starts from the fetched upstream tip, never the owner's possibly stale checkout.
      chooseBase: (fallback) =>
        chooseWorkspaceBase(gitWorkspaceBase(repository.repositoryRoot), fallback),
      // Every hosted session is a Lervo session, even in a worktree without project hooks.
      terminalHooks: (workspacePath) => hostedTerminalHooks(adapter, workspacePath),
      // Its first prompt must record turn evidence, which needs a repository snapshot in time.
      // The knowledge snapshot of the same bytes is the prompt's next per-checkout cache.
      // The worktree's file hashes, and the repository's knowledge snapshot if none is cached.
      warmRepositorySnapshot: prefetchTerminalPromptContext,
      ...git,
      startWorkstream: startWorkstreamIn,
      recordLaunch,
      writeSettings: writeHostedSessionSettings,
      recordEvents: (events) => recordEvents(repository.repositoryRoot, events),
      coordinate: async (request) => {
        const coordination = await coordinateConversationWorkspace(
          request,
          conversationCoordinationPorts(git.provisionedMarker),
        );
        // Every session in the worktree then claims its writes, hosted or the owner's terminal.
        if (coordination.status === "active")
          await writeClaimHandler(request.workspacePath, request.provider);
        return coordination;
      },
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
  const sessionHooks = hostedSessionHooks(adapter, sessionId);
  // A conversation that claims keeps claiming when it reopens, even if its worktree lost the
  // handler the start wrote.
  const terminal =
    sessionHooks === undefined
      ? undefined
      : await hostedTerminalHooks(adapter, workingDirectory, {
          claims: (await readNewestConversationWorkspace(repositoryRoot, workspaceId)) !== null,
        });
  const hooks =
    sessionHooks === undefined || terminal === undefined
      ? sessionHooks
      : { ...sessionHooks, terminal };
  // The reopened session is the same agent's (Lervo ADE agents, "Participants and sessions"), on
  // the model and effort the agent has now.
  const chosen = await agentLaunchModel(repositoryRoot, previous.agentId, adapter);
  const launch = withSessionEnvironment(
    adapter.prepareLaunch({
      sessionId,
      mode,
      workingDirectory,
      ...chosen,
      start: resume ? { kind: "resume" } : { kind: "new", instruction: "Continue." },
      ...(hooks === undefined ? {} : { hooks }),
      // The conversation keeps answering questions with choices while it runs natively.
      ...(previous.questions === true && mode === "native" ? { questions: true } : {}),
    }),
    previous.agentId,
  );
  if (launch.settingsFile !== null) await writeHostedSessionSettings(launch.settingsFile);
  const written =
    terminal === undefined ? undefined : writtenTerminalHooks(terminal, launch.settingsFile);
  const { terminalHooks: _previousTerminal, ...kept } = previous;
  const record: HostedLaunchRecord = {
    ...kept,
    ...(written === undefined ? {} : { terminalHooks: written }),
    sessionId,
    conversationMode: mode,
    argumentDigest: launchArgumentDigest(launch),
    settingsDigest: launch.settingsFile === null ? null : settingsFileDigest(launch.settingsFile),
    preparedAt: new Date().toISOString(),
    // Opening is no activity: the conversation keeps its place in the list.
    listedAt: listedTime(previous),
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
