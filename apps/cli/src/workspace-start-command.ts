import { parseArgs } from "node:util";

import { CommandFailure, writeCommandError } from "./command-error-output.js";
import type { CliIo } from "./types.js";
import { sendToConversation } from "./workspace-agent-send.js";
import { startAgentConversation } from "./workspace-agent-start.js";
import {
  openWorkspace,
  parseConversationMode,
  startWorkspaceFromInstruction,
} from "./workspace-launch-service.js";

const MAX_INSTRUCTION_BYTES = 256 * 1024;

export const workspaceStartUsage = `  lervo workspace start --repository <project-id> [--provider <provider>] [--mode native|cli] [--model <model>] [--title <title>] [--started-by <agent-id> [--lead <agent-id>]] --json < instruction
  lervo workspace send --workspace <workspace-id> --from <agent-id> --json < request
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
      title: { type: "string" },
      "started-by": { type: "string" },
      lead: { type: "string" },
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
    const options = {
      instruction: await io.stdin(MAX_INSTRUCTION_BYTES),
      repository: values.repository,
      ...(mode === undefined ? {} : { mode }),
      ...(values.provider === undefined ? {} : { provider: values.provider }),
      ...(values.model === undefined ? {} : { model: values.model }),
      ...(values.title === undefined ? {} : { title: values.title }),
    };
    const startedBy = values["started-by"];
    if (startedBy === undefined && values.lead !== undefined)
      throw new CommandFailure("launch_intent_invalid", "--lead needs --started-by.");
    // A conversation an agent starts, for itself or a teammate to lead, opens when its turn ends
    // (Lervo ADE rooms, slice 2; ADR-0657).
    const result =
      startedBy === undefined
        ? await startWorkspaceFromInstruction(options)
        : await startAgentConversation({
            ...options,
            startedBy,
            ...(values.lead === undefined ? {} : { lead: values.lead }),
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

/** Sends work to a conversation a teammate already leads, delivered when the turn ends (ADR-0657). */
async function runSend(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { workspace: { type: "string" }, from: { type: "string" }, json: { type: "boolean" } },
  });
  const json = values.json === true;
  try {
    if (values.workspace === undefined || values.from === undefined)
      throw new CommandFailure("launch_intent_invalid", "--workspace and --from are required.");
    if (io.stdin === undefined)
      throw new CommandFailure("launch_intent_invalid", "The request must arrive on stdin.");
    const text = (await io.stdin(MAX_INSTRUCTION_BYTES)).trim();
    if (text === "") throw new CommandFailure("launch_intent_invalid", "The request is empty.");
    const result = await sendToConversation({
      workspaceId: values.workspace,
      from: values.from,
      text,
    });
    io.stdout(
      json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Work queued for ${result.agentId} in ${result.workspaceId}; it is delivered when your turn ends.\n`,
    );
    return 0;
  } catch (error) {
    writeCommandError(io, error, { json });
    return 1;
  }
}

export async function runWorkspaceLaunchCommand(
  action: "start" | "open" | "send",
  args: string[],
  io: CliIo,
): Promise<number> {
  if (action === "send") return runSend(args, io);
  return action === "start" ? runStart(args, io) : runOpen(args, io);
}
