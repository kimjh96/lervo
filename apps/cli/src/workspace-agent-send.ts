// Work an agent sends to a conversation a teammate already leads (ADR-0657): the request waits
// beside the pending starts and reaches the lead, as the sender's message, when the sender's turn
// ends, so the work goes on where its owner already holds the context.
import { CommandFailure } from "./command-error-output.js";
import {
  hostedConversationProfilesPath,
  ownerConversationTitle,
} from "./hosted-conversation-profiles.js";
import { isConversationLead, roomSessionRecords } from "./hosted-launch-records.js";
import { pendingSendsPath, recordPendingSend, AGENT_SENDS_PER_HOUR } from "./room-sends.js";
import { locateWorkspaceSession } from "./workspace-launch-service.js";
import { resolveParticipants } from "./workspace-participants.js";
import { workstreamTitle } from "./workstream-title.js";

export interface WorkspaceSendResult {
  readonly schemaVersion: 1;
  readonly status: "queued";
  readonly sendId: string;
  readonly workspaceId: string;
  /** The lead the work goes to. */
  readonly agentId: string;
}

/**
 * Queues `text` for the lead of `workspaceId`. Only the calling session's own agent may send
 * (`agent_not_caller`), to a conversation another active teammate leads (`send_target_invalid`,
 * `send_target_self`, `participant_invalid`), at most {@link AGENT_SENDS_PER_HOUR} an hour
 * (`conversation_send_limited`).
 */
export async function sendToConversation(
  options: { readonly workspaceId: string; readonly from: string; readonly text: string },
  environment: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<WorkspaceSendResult> {
  if (environment.LERVO_AGENT_ID !== options.from)
    throw new CommandFailure(
      "agent_not_caller",
      "An agent sends work only as itself, from its own session.",
    );
  const { path, previous, workingDirectory, repositoryRoot } = await locateWorkspaceSession(
    options.workspaceId,
  );
  const lead = (await roomSessionRecords(path, options.workspaceId)).find(
    (record) => isConversationLead(record, options.workspaceId) && record.agentId !== undefined,
  );
  if (lead?.agentId === undefined)
    throw new CommandFailure("send_target_invalid", "No agent leads that conversation.");
  if (lead.agentId === options.from)
    throw new CommandFailure(
      "send_target_self",
      "You lead that conversation; do the work there yourself.",
    );
  // The sender and the lead are both active teammates of the conversation's project.
  await resolveParticipants(repositoryRoot, [options.from, lead.agentId]);
  const send = await recordPendingSend(
    pendingSendsPath(environment),
    {
      workspaceId: options.workspaceId,
      agentId: lead.agentId,
      sessionId: lead.sessionId,
      title:
        (await ownerConversationTitle(
          hostedConversationProfilesPath(environment),
          options.workspaceId,
        )) ??
        (await workstreamTitle(workingDirectory)) ??
        previous.branch,
      sentBy: options.from,
      text: options.text,
    },
    now,
  );
  if (send === null)
    throw new CommandFailure(
      "conversation_send_limited",
      `An agent sends work at most ${AGENT_SENDS_PER_HOUR} times an hour.`,
    );
  return {
    schemaVersion: 1,
    status: "queued",
    sendId: send.sendId,
    workspaceId: send.workspaceId,
    agentId: send.agentId,
  };
}
