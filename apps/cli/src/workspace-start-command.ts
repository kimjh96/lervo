import { parseArgs } from "node:util";

import { CommandFailure, writeCommandError } from "./command-error-output.js";
import type { CliIo } from "./types.js";
import {
  openWorkspace,
  parseConversationMode,
  startWorkspaceFromInstruction,
} from "./workspace-launch-service.js";

const MAX_INSTRUCTION_BYTES = 256 * 1024;

export const workspaceStartUsage = `  lervo workspace start --repository <project-id> [--provider <provider>] [--mode native|cli] [--model <model>] --json < instruction
  lervo workspace open --workspace <workspace-id> [--mode native|cli] --json`;

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
    const mode = parseConversationMode(values.mode);
    const result = await startWorkspaceFromInstruction({
      instruction: await io.stdin(MAX_INSTRUCTION_BYTES),
      repository: values.repository,
      ...(mode === undefined ? {} : { mode }),
      ...(values.provider === undefined ? {} : { provider: values.provider }),
      ...(values.model === undefined ? {} : { model: values.model }),
    });
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
    const result = await openWorkspace(values.workspace, parseConversationMode(values.mode));
    io.stdout(
      json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Workspace opened.\nworkspace: ${result.workspaceId}\nsession: ${result.sessionId}\n`,
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
