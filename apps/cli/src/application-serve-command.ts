import { CommandFailure } from "./command-error-output.js";
import { type CoreLinkHandlers, CoreLinkServer } from "./core-link-server.js";
import { createHostedStreamDecoder, listHostedProviders } from "./hosted-session-adapters.js";
import { listRepositories, listWorkspaces } from "./workspace-list-service.js";
import {
  openWorkspace,
  parseConversationMode,
  startWorkspaceFromInstruction,
} from "./workspace-launch-service.js";
import { WorkspaceTranscripts } from "./workspace-transcript-service.js";
import { recordHostedSessionExit } from "./hosted-session-exit.js";

const transcripts = new WorkspaceTranscripts();

/** The `workspace.start` arguments the core link accepts. */
function startArguments(arguments_: Record<string, unknown>) {
  const { instruction, repository, provider, mode, model } = arguments_;
  const optional = (value: unknown) => value === undefined || typeof value === "string";
  if (
    typeof instruction !== "string" ||
    typeof repository !== "string" ||
    !optional(provider) ||
    !optional(model)
  )
    throw new CommandFailure(
      "launch_intent_invalid",
      "workspace.start takes instruction and repository, and optionally provider, mode, and model.",
    );
  const requested = parseConversationMode(mode);
  return {
    instruction,
    repository,
    ...(requested === undefined ? {} : { mode: requested }),
    ...(typeof provider === "string" ? { provider } : {}),
    ...(typeof model === "string" ? { model } : {}),
  };
}

export const coreLinkHandlers: CoreLinkHandlers = {
  startWorkspace: (arguments_) => startWorkspaceFromInstruction(startArguments(arguments_)),
  listWorkspaces,
  listRepositories,
  listProviders: () => listHostedProviders(),
  openWorkspace: (workspaceId, mode) => openWorkspace(workspaceId, mode),
  createDecoder: createHostedStreamDecoder,
  readTranscript: (workspaceId, offset, limit) => transcripts.read(workspaceId, offset, limit),
  recordSessionExit: (sessionId, exitCode) => recordHostedSessionExit(sessionId, exitCode),
};

/**
 * `lervo application serve --stdio`: the resident Lervo process for one session host, which
 * starts it and speaks the core-link protocol over its standard streams. It ends when the
 * session host closes its input, and nothing else writes to its standard output.
 */
export async function serveCoreLinkOverStandardStreams(): Promise<number> {
  const server = new CoreLinkServer(coreLinkHandlers, (line) => {
    process.stdout.write(`${line}\n`);
  });
  const end = await server.serve(process.stdin);
  if (end === "message_invalid") {
    process.stderr.write("core_link_message_invalid\n");
    return 1;
  }
  return 0;
}
