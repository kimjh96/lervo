import { basename, resolve } from "node:path";

import {
  HostedLaunchError,
  type HostedConversationMode,
  type HostedLaunch,
  type HostedSessionAdapter,
  type HostedSessionHooks,
} from "@lervo/adapter-contract";

import { CommandFailure, errorCode } from "./command-error-output.js";
import { type HostedLaunchRecord, launchArgumentDigest } from "./hosted-launch-records.js";
import {
  launchPreparedEvent,
  workspaceStartedEvent,
  type HostedSessionEvent,
  type HostedSessionEventOutcome,
} from "./hosted-session-events.js";
import { settingsFileDigest } from "./hosted-session-settings.js";
import type { HostedTerminalHookPlan } from "./hosted-terminal-hooks.js";
import type { WorkspaceBase, WorkspaceBaseNotice } from "./workspace-base.js";
import { workspacesHome } from "./workspaces-home.js";

const TITLE_CHARACTERS = 80;
const OBJECTIVE_CHARACTERS = 8192;
const SLUG_CHARACTERS = 40;

/** The stage of `lervo workspace start` that failed (Lervo ADE sessions, failure meanings). */
export type WorkspaceStartStage = "workspace" | "workstream" | "launch";

/** Where a new workspace lives. */
export interface WorkspacePlacement {
  readonly repositoryRoot: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly branch: string;
  readonly workspacePath: string;
  readonly baseCommit: string;
  /** Unpublished knowledge commits to replay on the new branch, oldest first. */
  readonly replay?: readonly string[];
}

/** What replaying knowledge commits on a new branch did: all of them, or none. */
export interface EffectReplay {
  readonly replayed: readonly string[];
  /** Every commit, when the replay was dropped; the workspace starts without them. */
  readonly skipped: readonly string[];
  /** Commits whose change the branch already held, so the pick added nothing. */
  readonly carried: readonly string[];
  /** False when the replay was dropped and the branch returned to its base. */
  readonly complete: boolean;
}

/** The effects `startWorkspace` composes. Each is undone by a later stage's failure. */
export interface WorkspaceStartPorts {
  readonly adapter: HostedSessionAdapter;
  /**
   * Chooses where the workspace starts, once the provider accepted the launch intent; absent,
   * the request's `baseCommit` is the base. It fetches, so a refused intent never waits for it.
   * `fallback` is the request's `baseCommit`, for a repository that names no default branch.
   */
  chooseBase?(fallback: string): Promise<WorkspaceBase>;
  /**
   * Lervo's terminal hooks for the events the new worktree's project settings lack, read once the
   * worktree exists; absent, the launch carries only the request's hooks.
   */
  terminalHooks?(workspacePath: string): Promise<HostedTerminalHookPlan | undefined>;
  provisionWorkspace(placement: WorkspacePlacement): Promise<void>;
  /** Replays the placement's effect commits on its new branch; absent where none can exist. */
  replayEffects?(placement: WorkspacePlacement): Promise<EffectReplay>;
  /** Removes the worktree and its branch. Throws when either remains. */
  removeWorkspace(placement: WorkspacePlacement): Promise<void>;
  /** Starts the workstream in the new worktree and returns its ID. */
  startWorkstream(input: { root: string; title: string; objective: string }): Promise<string>;
  recordLaunch(record: HostedLaunchRecord): Promise<void>;
  /** Writes the launch's session-scoped settings file. */
  writeSettings(file: { readonly path: string; readonly content: string }): Promise<void>;
  /**
   * Records hosted session events in the registered repository. It never throws: a store that
   * cannot take them reports `unavailable`, and the launch goes on.
   */
  recordEvents(
    events: readonly HostedSessionEvent[],
  ): Promise<HostedSessionEventOutcome | "unavailable">;
  now(): Date;
}

export interface WorkspaceStartRequest {
  readonly instruction: string;
  readonly mode: HostedConversationMode;
  readonly repositoryRoot: string;
  readonly projectId: string;
  /** The base when the ports do not choose one. */
  readonly baseCommit: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  /** A short random suffix that keeps branch names unique. */
  readonly suffix: string;
  readonly model?: string;
  /** Lervo's hook handler, when the provider's adapter declares `hooks`. */
  readonly hooks?: HostedSessionHooks;
}

export interface WorkspaceStartResult {
  schemaVersion: 1;
  status: "started";
  workspaceId: string;
  workstreamId: string;
  projectId: string;
  branch: string;
  sessionId: string;
  provider: string;
  launch: HostedLaunch;
  /** Whether the repository took the hosted session events (`hosted_events_inactive` otherwise). */
  hostedEvents: HostedSessionEventOutcome | "unavailable";
  /**
   * Where the workspace started, for the interface to tell the user after the fact; absent when
   * the caller chose the base itself. Counts only: the commits stay in the launch record.
   */
  base?: WorkspaceStartBase;
}

/** The start result's account of the base (Lervo ADE sessions, "The workspace's base"). */
export interface WorkspaceStartBase {
  source: "upstream" | "local";
  upstream: string | null;
  notice: WorkspaceBaseNotice | "replay_incomplete" | null;
  replayed: number;
  skipped: number;
  carried: number;
}

/** The workstream title: the instruction's first line, shortened at a word. */
export function titleFor(instruction: string): string {
  const line =
    instruction
      .split(/\r?\n/u)
      .map((item) => item.replace(/\s+/gu, " ").trim())
      .find((item) => item.length > 0) ?? "";
  if ([...line].length <= TITLE_CHARACTERS) return line;
  const cut = [...line].slice(0, TITLE_CHARACTERS - 1).join("");
  const word = cut.lastIndexOf(" ");
  return `${(word > TITLE_CHARACTERS / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}

/** The workstream objective: the instruction within the workstream's limit. */
export function objectiveFor(instruction: string): string {
  const text = instruction.trim();
  const characters = [...text];
  return characters.length <= OBJECTIVE_CHARACTERS
    ? text
    : `${characters.slice(0, OBJECTIVE_CHARACTERS - 1).join("")}…`;
}

/** `lervo/<words>-<suffix>`, from the title's ASCII words, or `lervo/work-<suffix>`. */
export function branchFor(title: string, suffix: string): string {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0);
  let slug = "";
  for (const word of words) {
    const next = slug.length === 0 ? word : `${slug}-${word}`;
    if (next.length > SLUG_CHARACTERS) break;
    slug = next;
  }
  return `lervo/${slug.length === 0 ? "work" : slug}-${suffix}`;
}

/** The worktree path: `<workspaces home>/<repository name>/<branch leaf>`. */
export function workspacePathFor(
  repositoryRoot: string,
  branch: string,
  home: string = workspacesHome(),
): string {
  const leaf = branch.slice(branch.lastIndexOf("/") + 1);
  return resolve(home, basename(repositoryRoot), leaf);
}

function stageFailure(
  stage: WorkspaceStartStage,
  error: unknown,
  rolledBack: boolean,
): CommandFailure {
  const cause = errorCode(error);
  const detail = error instanceof Error ? error.message : String(error);
  return new CommandFailure(
    "workspace_start_failed",
    `The ${stage} stage failed: ${detail}${rolledBack ? "" : " Rollback did not finish."}`,
    { stage, cause, rolledBack },
  );
}

/**
 * Creates the worktree and branch, starts the workstream, and prepares the hosted launch. When a
 * stage fails, it removes what the earlier stages created and reports the failed stage.
 */
export async function startWorkspace(
  request: WorkspaceStartRequest,
  ports: WorkspaceStartPorts,
): Promise<WorkspaceStartResult> {
  const title = titleFor(request.instruction);
  const branch = branchFor(title, request.suffix);
  const workspacePath = workspacePathFor(request.repositoryRoot, branch);
  const intent = {
    sessionId: request.sessionId,
    mode: request.mode,
    workingDirectory: workspacePath,
    start: { kind: "new" as const, instruction: request.instruction },
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.hooks === undefined ? {} : { hooks: request.hooks }),
  };
  // Refuse an intent the provider cannot run before anything changes.
  try {
    ports.adapter.prepareLaunch(intent);
  } catch (error) {
    if (error instanceof HostedLaunchError) throw new CommandFailure(error.code, error.message);
    throw error;
  }

  const base =
    ports.chooseBase === undefined
      ? undefined
      : await ports.chooseBase(request.baseCommit).catch((): WorkspaceBase => ({
          commit: request.baseCommit,
          source: "local",
          upstream: null,
          replay: [],
          notice: "base_unresolved",
        }));
  const placement: WorkspacePlacement = {
    repositoryRoot: request.repositoryRoot,
    projectId: request.projectId,
    workspaceId: request.workspaceId,
    branch,
    workspacePath,
    baseCommit: base?.commit ?? request.baseCommit,
    replay: base?.replay ?? [],
  };
  let replay: EffectReplay = { replayed: [], skipped: [], carried: [], complete: true };
  try {
    await ports.provisionWorkspace(placement);
    if ((placement.replay?.length ?? 0) > 0 && ports.replayEffects !== undefined)
      replay = await ports.replayEffects(placement);
  } catch (error) {
    throw stageFailure("workspace", error, await undo(ports, placement));
  }
  let stage: WorkspaceStartStage = "workstream";
  try {
    const workstreamId = await ports.startWorkstream({
      root: placement.workspacePath,
      title,
      objective: objectiveFor(request.instruction),
    });
    stage = "launch";
    const terminal =
      intent.hooks === undefined || ports.terminalHooks === undefined
        ? undefined
        : await ports.terminalHooks(placement.workspacePath);
    const launch = ports.adapter.prepareLaunch(
      terminal === undefined || intent.hooks === undefined
        ? intent
        : { ...intent, hooks: { ...intent.hooks, terminal } },
    );
    if (launch.settingsFile !== null) await ports.writeSettings(launch.settingsFile);
    const record: HostedLaunchRecord = {
      schemaVersion: 1,
      workspaceId: placement.workspaceId,
      sessionId: request.sessionId,
      provider: ports.adapter.provider,
      projectId: placement.projectId,
      branch,
      conversationMode: request.mode,
      argumentDigest: launchArgumentDigest(launch),
      settingsDigest: launch.settingsFile === null ? null : settingsFileDigest(launch.settingsFile),
      mcpConfigDigest: null,
      preparedAt: ports.now().toISOString(),
      ...(terminal === undefined
        ? {}
        : {
            terminalHooks: {
              events: terminal.events.map((event) => event.name),
              via: terminal.via,
            },
          }),
      ...(base === undefined
        ? {}
        : {
            base: {
              commit: base.commit,
              source: base.source,
              upstream: base.upstream,
              replayed: [...replay.replayed],
              skipped: [...replay.skipped],
              carried: [...replay.carried],
              notice: replay.complete ? base.notice : "replay_incomplete",
            },
          }),
    };
    await ports.recordLaunch(record);
    const hostedEvents = await ports.recordEvents([
      workspaceStartedEvent({ record, workstreamId, instruction: request.instruction }),
      launchPreparedEvent(record),
    ]);
    return {
      schemaVersion: 1,
      status: "started",
      workspaceId: placement.workspaceId,
      workstreamId,
      projectId: placement.projectId,
      branch,
      sessionId: request.sessionId,
      provider: ports.adapter.provider,
      launch,
      hostedEvents,
      ...(record.base === undefined
        ? {}
        : {
            base: {
              source: record.base.source,
              upstream: record.base.upstream,
              notice: record.base.notice,
              replayed: record.base.replayed.length,
              skipped: record.base.skipped.length,
              carried: record.base.carried.length,
            },
          }),
    };
  } catch (error) {
    throw stageFailure(stage, error, await undo(ports, placement));
  }
}

async function undo(ports: WorkspaceStartPorts, placement: WorkspacePlacement): Promise<boolean> {
  try {
    await ports.removeWorkspace(placement);
    return true;
  } catch {
    return false;
  }
}
