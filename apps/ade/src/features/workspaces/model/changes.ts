import { conversationOrder } from "@lervo/session-host-contract";

import { type ApplicationCommands, failureCode, type ListCache } from "../../../ports";
import { reloadWorkspaces } from "./controller";
import { useWorkspaceStore } from "./store";
import type { Workspace } from "./types";

// The owner's changes to a conversation (Lervo ADE sessions, "Renaming and pinning"): its title
// and its pin, which the core keeps host-side.

/** What a conversation change needs. */
export interface ConversationChangeDependencies {
  readonly commands: ApplicationCommands;
  readonly lists?: ListCache;
}

/** Whether the core renames and pins conversations; an older core offers neither. */
export const changesConversations = (advertised: readonly string[] | null) => ({
  renames: advertised?.includes("workspace.rename") === true,
  pins: advertised?.includes("workspace.pin") === true,
});

/**
 * Runs one change (ADE craft rules, 22): the listed conversation takes it at once, in the list's
 * order, so a pinned row moves before the core answers and never moves back. The lists reload
 * once the core answers; a refusal reloads them too, which shows the conversation as it was, and
 * records its code.
 */
async function change(
  dependencies: ConversationChangeDependencies,
  workspaceId: string,
  shown: (workspace: Workspace) => Workspace,
  run: () => Promise<unknown>,
): Promise<void> {
  const { workspaces } = useWorkspaceStore.getState();
  useWorkspaceStore.setState({
    changeFailure: null,
    workspaces: conversationOrder(
      workspaces.map((workspace) =>
        workspace.workspaceId === workspaceId ? shown(workspace) : workspace,
      ),
    ),
  });
  try {
    await run();
  } catch (failure) {
    useWorkspaceStore.setState({ changeFailure: failureCode(failure) });
  }
  await reloadWorkspaces(dependencies.commands, dependencies.lists).catch(() => undefined);
}

/** Gives the conversation the owner's title, which its agent's updates never replace. */
export async function renameConversation(
  dependencies: ConversationChangeDependencies,
  workspaceId: string,
  title: string,
): Promise<void> {
  await change(
    dependencies,
    workspaceId,
    (workspace) => ({ ...workspace, title }),
    () => dependencies.commands.run("workspace.rename", { workspaceId, title }),
  );
}

/**
 * Pins the conversation to the top of the list, or unpins it, which returns it to its place.
 * `now` is when the person pinned it, as the core records it too.
 */
export async function pinConversation(
  dependencies: ConversationChangeDependencies,
  workspaceId: string,
  pinned: boolean,
  now: Date = new Date(),
): Promise<void> {
  await change(
    dependencies,
    workspaceId,
    (workspace) => {
      const next = { ...workspace };
      if (pinned) next.pinnedAt = now.toISOString();
      else delete next.pinnedAt;
      return next;
    },
    () => dependencies.commands.run("workspace.pin", { workspaceId, pinned }),
  );
}
