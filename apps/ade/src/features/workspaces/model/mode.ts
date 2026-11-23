import type { ApplicationCommands, SessionHost } from "../../../ports";
import { reloadWorkspaces } from "./controller";
import { useWorkspaceStore } from "./store";

/**
 * Switches a workspace between the native and the CLI conversation. The session host stops the
 * running provider process and the core resumes the same session in the other mode. The view
 * follows the mode the session host confirms at once, so it never shows one conversation over a
 * session that runs the other; the reloaded list then confirms it from the core.
 */
export async function switchConversationMode(input: {
  client: SessionHost;
  commands: ApplicationCommands;
  workspaceId: string;
  mode: "native" | "cli";
}): Promise<void> {
  const opened = await input.client.request({
    kind: "session.open",
    workspaceId: input.workspaceId,
    conversationMode: input.mode,
  });
  if (opened.kind === "session.opened") {
    const { conversationMode, sessionId } = opened;
    useWorkspaceStore.setState((store) => ({
      workspaces: store.workspaces.map((workspace) =>
        workspace.workspaceId === input.workspaceId
          ? { ...workspace, conversationMode, sessionId }
          : workspace,
      ),
    }));
  }
  await reloadWorkspaces(input.commands);
}
