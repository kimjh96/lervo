import { cliCommandCatalog } from "./cli-command-catalog.js";
import { CommandFailure } from "./command-error-output.js";
import { type CoreLinkHandlers, CoreLinkServer } from "./core-link-server.js";
import { createHostedStreamDecoder, listHostedProviders } from "./hosted-session-adapters.js";
import { runCoreLinkAgentCommand } from "./core-link-agent-commands.js";
import { runCoreLinkProjectCommand } from "./core-link-project-commands.js";
import { listRepositories, listWorkspaces } from "./workspace-list-service.js";
import {
  openWorkspace,
  parseConversationMode,
  startWorkspaceFromInstruction,
} from "./workspace-launch-service.js";
import { WorkspaceTranscripts } from "./workspace-transcript-service.js";
import { recordHostedTurnUsage } from "./hosted-turn-usage-events.js";
import { reconcileExitedSession } from "./conversation-turn-reconciliation.js";
import { recordHostedSessionExit } from "./hosted-session-exit.js";
import { retireHostedWorkspace } from "./hosted-workspace-retire.js";
import { hostedWorkspaceRetireEffects } from "./hosted-workspace-retire-effects.js";
import { withLervoCall } from "./lervo-command-detail.js";
import { summarizeWorkspaceTurns } from "./turn-summary-service.js";
import { joinWorkspaceRoom, routeRoomTurn } from "./workspace-room.js";
import { loadRoomContext } from "./room-context.js";
import { writeConversationNote } from "./conversation-notes.js";
import { roomAnswers } from "./room-answers.js";
import { recordRoomEvents } from "./room-events.js";
import { pendingStartsOf, pendingStartsPath } from "./room-starts.js";

const transcripts = new WorkspaceTranscripts();

/** The `workspace.start` arguments the core link accepts. */
function startArguments(arguments_: Record<string, unknown>) {
  const { instruction, repository, provider, mode, model, participants, questions } = arguments_;
  const optional = (value: unknown) => value === undefined || typeof value === "string";
  if (
    typeof instruction !== "string" ||
    typeof repository !== "string" ||
    !optional(provider) ||
    !optional(model) ||
    !(questions === undefined || typeof questions === "boolean")
  )
    throw new CommandFailure(
      "launch_intent_invalid",
      "workspace.start takes instruction and repository, and optionally provider, mode, model, participants, and questions.",
    );
  const requested = parseConversationMode(mode);
  return {
    instruction,
    repository,
    ...(requested === undefined ? {} : { mode: requested }),
    ...(typeof provider === "string" ? { provider } : {}),
    ...(typeof model === "string" ? { model } : {}),
    // Checked against the project's agents when the workspace starts.
    ...(participants === undefined ? {} : { participants }),
    ...(questions === true ? { questions } : {}),
  };
}

export const coreLinkHandlers: CoreLinkHandlers = {
  startWorkspace: (arguments_) => startWorkspaceFromInstruction(startArguments(arguments_)),
  listWorkspaces,
  listRepositories,
  listProviders: () => listHostedProviders(),
  runProjectCommand: runCoreLinkProjectCommand,
  runAgentCommand: runCoreLinkAgentCommand,
  joinRoom: joinWorkspaceRoom,
  loadRoomContext,
  pendingStarts: (agentId) => pendingStartsOf(pendingStartsPath(), agentId),
  recordRoomEvents,
  writeConversationNote: (note) => writeConversationNote(note),
  routeRoom: routeRoomTurn,
  roomAnswers,
  openWorkspace: (workspaceId, mode) => openWorkspace(workspaceId, mode),
  createDecoder: createHostedStreamDecoder,
  readTranscript: (workspaceId, offset, limit) => transcripts.read(workspaceId, offset, limit),
  retireWorkspace: (workspaceId, options) =>
    retireHostedWorkspace(workspaceId, hostedWorkspaceRetireEffects(), options),
  recordSessionExit: async (sessionId, exitCode) => {
    try {
      return await recordHostedSessionExit(sessionId, exitCode);
    } finally {
      // A crash runs no `Stop`, so the lead's exit reconciles its conversation's claims.
      await reconcileExitedSession(sessionId);
    }
  },
  summarizeTurns: (arguments_) => summarizeWorkspaceTurns(arguments_),
  recordTurnUsage: (sessionId, accounting, usage) =>
    recordHostedTurnUsage(sessionId, accounting, usage),
};

/**
 * `lervo application serve --stdio`: the resident Lervo process for one session host, which
 * starts it and speaks the core-link protocol over its standard streams. It ends when the
 * session host closes its input, and nothing else writes to its standard output.
 */
export async function serveCoreLinkOverStandardStreams(): Promise<number> {
  // The usage text lives in the entrypoint, which is fully loaded once a command runs.
  const { cliUsage } = await import("./main.js");
  const commands = new Set(
    cliCommandCatalog(cliUsage).map((command) => command.slice("lervo ".length)),
  );
  const handlers: CoreLinkHandlers = {
    ...coreLinkHandlers,
    annotate: (content) => withLervoCall(content, commands),
  };
  const server = new CoreLinkServer(handlers, (line) => {
    process.stdout.write(`${line}\n`);
  });
  const end = await server.serve(process.stdin);
  if (server.usage.dropped > 0)
    process.stderr.write(`core_link_turn_usage_dropped ${server.usage.dropped}\n`);
  if (end === "message_invalid") {
    process.stderr.write("core_link_message_invalid\n");
    return 1;
  }
  return 0;
}
