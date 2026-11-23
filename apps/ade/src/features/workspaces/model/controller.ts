import type { HostMessage } from "@lervo/session-host-contract";

import type { Notifier } from "../../../platform/notifications";
import type { ApplicationCommands, SessionHostClient } from "../../../platform/session-host";
import { arrivals, type NotificationKind, notificationFor } from "./decisions";
import { useWorkspaceStore } from "./store";
import type { Repository, SessionStatus, Workspace } from "./types";

/** Formats a notification from the catalog. */
export type NotificationText = (
  kind: NotificationKind,
  title: string,
) => { title: string; body: string };

/** Reloads the workspace and repository lists from the core. */
export async function reloadWorkspaces(commands: ApplicationCommands): Promise<void> {
  const [workspaces, repositories] = await Promise.all([
    commands.run("workspace.list"),
    commands.run("repository.list"),
  ]);
  const store = useWorkspaceStore.getState();
  const next = (workspaces.workspaces as Workspace[] | undefined) ?? [];
  const arrived = arrivals(store.loaded ? store.workspaces : null, next);
  useWorkspaceStore.setState({
    workspaces: next,
    repositories: (repositories.repositories as Repository[] | undefined) ?? [],
    loaded: true,
    arrived: new Set([...store.arrived, ...arrived]),
  });
}

/**
 * Keeps the workspace store current: on each connection it loads the lists and watches every
 * session's status, and it notifies when a session that the user is not looking at needs them
 * or finishes. Returns the unsubscribe function.
 */
export function bindWorkspaces(input: {
  client: SessionHostClient;
  commands: ApplicationCommands;
  notifier: Notifier;
  text: NotificationText;
  isFocused: () => boolean;
}): () => void {
  const { client, commands } = input;
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
  const next = message.status as SessionStatus;
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
