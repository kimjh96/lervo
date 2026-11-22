import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import type { HostedConversationMode } from "@lervo/adapter-contract";
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import { CommandFailure, writeCommandError } from "./command-error-output.js";
import {
  hostedLaunchRecordsPath,
  latestHostedLaunch,
  launchArgumentDigest,
  recordHostedLaunch,
} from "./hosted-launch-records.js";
import { resolveHostedSessionAdapter } from "./hosted-session-adapters.js";
import type { CliIo } from "./types.js";
import { startWorkspace } from "./workspace-start.js";
import {
  defaultBranchCommit,
  gitWorkspaceEffects,
  startWorkstreamIn,
  worktreeOfBranch,
} from "./workspace-start-effects.js";

const MAX_INSTRUCTION_BYTES = 256 * 1024;

export const workspaceStartUsage = `  lervo workspace start --repository <project-id> [--provider <provider>] [--mode native|cli] [--model <model>] --json < instruction
  lervo workspace open --workspace <workspace-id> [--mode native|cli] --json`;

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function parseMode(value: string | undefined): HostedConversationMode {
  if (value === undefined || value === "native" || value === "cli") return value ?? "native";
  throw new CommandFailure("launch_intent_invalid", "--mode must be native or cli.");
}

/** The registered repository, from the host's repository registry. */
async function registeredRepository(projectId: string) {
  return resolveRegisteredRepository({ registryPath: defaultRepositoryRegistryPath(), projectId });
}

async function runStart(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      repository: { type: "string" },
      provider: { type: "string" },
      mode: { type: "string" },
      model: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const json = values.json === true;
  try {
    if (values.repository === undefined)
      throw new CommandFailure("launch_intent_invalid", "--repository is required.");
    if (io.stdin === undefined)
      throw new CommandFailure("launch_intent_invalid", "The instruction must arrive on stdin.");
    const instruction = await io.stdin(MAX_INSTRUCTION_BYTES);
    const repository = await registeredRepository(values.repository);
    const adapter = await resolveHostedSessionAdapter(values.provider ?? "claude");
    const effects = gitWorkspaceEffects();
    const result = await startWorkspace(
      {
        instruction,
        mode: parseMode(values.mode),
        repositoryRoot: repository.repositoryRoot,
        projectId: repository.projectId,
        baseCommit: await defaultBranchCommit(repository.repositoryRoot),
        workspaceId: `wsp_${hex(12)}`,
        sessionId: randomUUID(),
        suffix: hex(3),
        ...(values.model === undefined ? {} : { model: values.model }),
      },
      {
        adapter,
        ...effects,
        startWorkstream: startWorkstreamIn,
        recordLaunch: (record) => recordHostedLaunch(hostedLaunchRecordsPath(), record),
        now: () => new Date(),
      },
    );
    io.stdout(
      json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Workspace started.\nworkspace: ${result.workspaceId}\nbranch: ${result.branch}\nworkstream: ${result.workstreamId}\nsession: ${result.sessionId}\n`,
    );
    return 0;
  } catch (error) {
    writeCommandError(io, error, { json });
    return 1;
  }
}

/**
 * Prepares the launch that continues a workspace's hosted session: a resume where the provider
 * supports one, otherwise a new session without an instruction.
 */
async function runOpen(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { workspace: { type: "string" }, mode: { type: "string" }, json: { type: "boolean" } },
  });
  const json = values.json === true;
  try {
    if (values.workspace === undefined)
      throw new CommandFailure("launch_intent_invalid", "--workspace is required.");
    const path = hostedLaunchRecordsPath();
    const previous = await latestHostedLaunch(path, values.workspace);
    if (previous === null)
      throw new CommandFailure("workspace_not_found", "No hosted launch exists for the workspace.");
    const repository = await registeredRepository(previous.projectId);
    const workingDirectory = await worktreeOfBranch(repository.repositoryRoot, previous.branch);
    if (workingDirectory === null)
      throw new CommandFailure("workspace_not_found", "The workspace's worktree no longer exists.");
    const adapter = await resolveHostedSessionAdapter(previous.provider);
    const mode = values.mode === undefined ? previous.conversationMode : parseMode(values.mode);
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
    const result = {
      schemaVersion: 1,
      status: "opened",
      workspaceId: previous.workspaceId,
      sessionId,
      provider: adapter.provider,
      resumed: resume,
      launch,
    };
    io.stdout(
      json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Workspace opened.\nworkspace: ${result.workspaceId}\nsession: ${sessionId}\n`,
    );
    return 0;
  } catch (error) {
    writeCommandError(io, error, { json });
    return 1;
  }
}

export async function runWorkspaceLaunchCommand(
  action: "start" | "open",
  args: string[],
  io: CliIo,
): Promise<number> {
  return action === "start" ? runStart(args, io) : runOpen(args, io);
}
