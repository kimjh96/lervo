// A conversation an agent starts for work of its own (Lervo ADE rooms, "How an agent starts a
// conversation"). The worktree and the lead's launch are prepared here; the session opens when the
// agent's turn ends, from the delivery the core makes of the pending start.
import { CommandFailure } from "./command-error-output.js";
import { conversationsStartedBy, hostedLaunchRecordsPath } from "./hosted-launch-records.js";
import { AGENT_STARTS_PER_HOUR, pendingStartsPath, recordPendingStart } from "./room-starts.js";
import {
  startWorkspaceFromInstruction,
  type WorkspaceStartOptions,
} from "./workspace-launch-service.js";
import { titleFor, type WorkspaceStartResult } from "./workspace-start.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Starts a conversation that `startedBy` leads. Only the calling session's own agent may start one
 * (`agent_not_caller`), and at most {@link AGENT_STARTS_PER_HOUR} an hour
 * (`conversation_start_limited`).
 */
export async function startAgentConversation(
  options: WorkspaceStartOptions & { readonly startedBy: string },
  environment: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<WorkspaceStartResult> {
  if (environment.LERVO_AGENT_ID !== options.startedBy)
    throw new CommandFailure(
      "agent_not_caller",
      "An agent starts a conversation only as itself, from its own session.",
    );
  const started = (
    await conversationsStartedBy(hostedLaunchRecordsPath(environment), options.startedBy)
  ).filter((record) => now.getTime() - Date.parse(record.preparedAt) < HOUR_MS);
  if (started.length >= AGENT_STARTS_PER_HOUR)
    throw new CommandFailure(
      "conversation_start_limited",
      `An agent starts at most ${AGENT_STARTS_PER_HOUR} conversations an hour.`,
    );
  const result = await startWorkspaceFromInstruction({
    ...options,
    participants: [options.startedBy],
  });
  const title = titleFor(options.title ?? options.instruction);
  await recordPendingStart(
    pendingStartsPath(environment),
    {
      workspaceId: result.workspaceId,
      agentId: options.startedBy,
      title,
      text: options.instruction,
      preparedAt: now.toISOString(),
    },
    now,
  );
  return result;
}
