import {
  type ApplicationCommands,
  ask,
  requestId,
  type SessionHostClient,
} from "../../../platform/session-host";
import { reloadWorkspaces } from "./controller";

/**
 * Switches a workspace between the native and the CLI conversation. The session host stops the
 * running provider process and the core resumes the same session in the other mode.
 */
export async function switchConversationMode(input: {
  client: SessionHostClient;
  commands: ApplicationCommands;
  workspaceId: string;
  mode: "native" | "cli";
}): Promise<void> {
  await ask(input.client, {
    kind: "session.open",
    requestId: requestId(),
    workspaceId: input.workspaceId,
    conversationMode: input.mode,
  });
  await reloadWorkspaces(input.commands);
}
