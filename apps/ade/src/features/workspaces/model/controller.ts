import type {
  HostMessage,
  RepositoryListResult,
  WorkspaceListResult,
} from "@lervo/session-host-contract";

import {
  type ApplicationCommands,
  failureCode,
  type ListCache,
  type Notifier,
  type SessionHost,
} from "../../../ports";
import { arrivals, type NotificationKind, notificationFor } from "./decisions";
import { useWorkspaceStore } from "./store";

/** Formats a notification from the catalog. */
export type NotificationText = (
  kind: NotificationKind,
  title: string,
) => { title: string; body: string };

/**
 * Shows the lists kept from the last launch until the core answers, so the start screen renders
 * at once (ADE performance, "Processes, protocol, and startup"). Lists the core already answered
 * stay.
 */
export function restoreWorkspaces(cache: ListCache): void {
  if (useWorkspaceStore.getState().loaded) return;
  const kept = cache.load();
  if (kept === null) return;
  useWorkspaceStore.setState({
    workspaces: kept.workspaces,
    repositories: kept.repositories,
    cached: true,
  });
}

/**
 * Reloads the workspace and repository lists from the core and keeps them for the next launch.
 * A failure keeps the last lists and records its code, so an unreachable core never looks like an
 * empty one.
 */
export async function reloadWorkspaces(
  commands: ApplicationCommands,
  cache?: ListCache,
): Promise<void> {
  let workspaces: WorkspaceListResult;
  let repositories: RepositoryListResult;
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
  const next = workspaces.workspaces;
  // Workspaces new since the kept lists appeared while the app was closed, so none arrives.
  const arrived = arrivals(store.loaded ? store.workspaces : null, next);
  cache?.save({ workspaces: next, repositories: repositories.repositories });
  useWorkspaceStore.setState({
    workspaces: next,
    repositories: repositories.repositories,
    loaded: true,
    cached: false,
    listFailure: null,
    advertisedCommands: workspaces.commands ?? [],
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
  lists: ListCache;
  notifier: Notifier;
  text: NotificationText;
  isFocused: () => boolean;
}): () => void {
  const { client, commands } = input;
  // Both run again on the next connection; the list shows a reload failure itself, and a watch
  // the connection cannot carry ends with it.
  const connected = () => {
    void client.send({ kind: "sessions.watch" }).catch(() => undefined);
    void reloadWorkspaces(commands, input.lists).catch(() => undefined);
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
