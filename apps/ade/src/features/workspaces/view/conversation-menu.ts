import type { IntlShape } from "react-intl";

import type { ApplicationCommands, ListCache, MenuItem, Menus } from "../../../ports";
import { type changesConversations, pinConversation } from "../model/changes";
import { useWorkspaceStore } from "../model/store";
import type { Workspace } from "../model/types";

/** What a conversation's menu needs. */
export interface ConversationMenuContext {
  readonly intl: IntlShape;
  readonly menus: Menus;
  readonly commands: ApplicationCommands;
  readonly lists: ListCache;
  /** Which changes the core answers; the menu offers only those. */
  readonly changes: ReturnType<typeof changesConversations>;
}

/**
 * A conversation row's context menu (Lervo ADE sessions, "Renaming and pinning"): rename its title
 * in the row, and pin it to the top of the list or unpin it. The system menu shows it, since no
 * item opens an overlay (ADE craft rules, 15).
 */
export function showConversationMenu(context: ConversationMenuContext, workspace: Workspace) {
  const { intl, changes } = context;
  const { workspaceId } = workspace;
  const items: MenuItem[] = [];
  if (changes.renames)
    items.push({
      text: intl.formatMessage({ id: "workspaces.menu.rename" }),
      run: () => useWorkspaceStore.setState({ renaming: workspaceId }),
    });
  if (changes.pins) {
    const pinned = workspace.pinnedAt !== undefined;
    items.push({
      text: pinned
        ? intl.formatMessage({ id: "workspaces.menu.unpin" })
        : intl.formatMessage({ id: "workspaces.menu.pin" }),
      run: () => void pinConversation(context, workspaceId, !pinned),
    });
  }
  if (items.length > 0) void context.menus.show(items);
}
