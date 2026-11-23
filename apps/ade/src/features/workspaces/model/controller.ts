import type { HostMessage } from "@lervo/session-host-contract";

import {
  type ApplicationCommands,
  failureCode,
  type Notifier,
  type SessionHost,
} from "../../../ports";
import { arrivals, type NotificationKind, notificationFor } from "./decisions";
import { useWorkspaceStore } from "./store";
import type { Repository, Workspace } from "./types";

/** Formats a notification from the catalog. */
export type NotificationText = (
  kind: NotificationKind,
  title: string,
) => { title: string; body: string };

/**
 * Reloads the workspace and repository lists from the core. A failure keeps the last lists and
 * records its code, so an unreachable core never looks like an empty one.
 */
export async function reloadWorkspaces(commands: ApplicationCommands): Promise<void> {
  let workspaces: Record<string, unknown>;
  let repositories: Record<string, unknown>;
  try {
    [workspaces, repositories] = await Promise.all([
      commands.run("workspace.list"),
      commands.run("repository.list"),
    ]);
  } catch (failure) {
    useWorkspaceStore.setState({
      listFailure: failureCode(failure),
    });
    throw failure;
  }
  const store = useWorkspaceStore.getState();
  const next = (workspaces.workspaces as Workspace[] | undefined) ?? [];
  const arrived = arrivals(store.loaded ? store.workspaces : null, next);
  useWorkspaceStore.setState({
    workspaces: next,
    repositories: (repositories.repositories as Repository[] | undefined) ?? [],
    loaded: true,
    listFailure: null,
    // Only listed workspaces can animate, so the set stays within the list's size.
    arrived: new Set(
      [...store.arrived, ...arrived].filter((workspaceId) =>
        next.some((workspace) => workspace.workspaceId === workspaceId),
      ),
    ),
  });
}

/**
 * Keeps the workspace store current: on each connection it loads the lists and watches every
 * session's status, and it notifies when a session that the user is not looking at needs them
 * or finishes. Returns the unsubscribe function.
 */
export function bindWorkspaces(input: {
  client: SessionHost;
  commands: ApplicationCommands;
  notifier: Notifier;
  text: NotificationText;
  isFocused: () => boolean;
}): () => void {
  const { client, commands } = input;
  // Both run again on the next connection; the list shows a reload failure itself, and a watch
  // the connection cannot carry ends with it.
  const connected = () => {
    void client.send({ kind: "sessions.watch" }).catch(() => undefined);
    void reloadWorkspaces(commands).catch(() => undefined);
  };
  const unsubscribeState = client.onState((state) => {
    if (state === "connected") connected();
  });
  if (client.connection === "connected") connected();
  const unsubscribeMessages = client.onMessage((message) => status(message, input));
  return () => {
    unsubscribeState();
    unsubscribeMessages();
  };
}

function status(
  message: HostMessage,
  input: { notifier: Notifier; text: NotificationText; isFocused: () => boolean },
): void {
  if (message.kind !== "session.status") return;
  const store = useWorkspaceStore.getState();
  const next = message.status;
  const previous = store.statuses[message.sessionId];
  useWorkspaceStore.setState({ statuses: { ...store.statuses, [message.sessionId]: next } });
  const workspace = store.workspaces.find((item) => item.sessionId === message.sessionId);
  if (workspace === undefined) return;
  const watched = input.isFocused() && store.selected === workspace.workspaceId;
  const kind = notificationFor(previous, next, watched);
  if (kind === null) return;
  const text = input.text(kind, workspace.title ?? workspace.branch);
  input.notifier.notify(text.title, text.body);
}
