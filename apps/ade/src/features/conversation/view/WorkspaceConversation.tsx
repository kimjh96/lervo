import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";

import { useApplicationCommands, useSessionHost } from "../../../ports";
import { useHostIsCurrent } from "../../connection";
import { useWorkspaceStore, visibleStatus } from "../../workspaces";
import { activityOf } from "../model/activity";
import { ConversationController } from "../model/controller";
import type { ConversationSource } from "../model/source";
import { StandInConversation } from "../model/stand-in-conversation";
import { useConversationStore } from "../model/store";
import { BaseNotice } from "./BaseNotice";
import { ConversationPane } from "./ConversationPane";
import { activityMessages } from "./messages";

/**
 * One workspace's native conversation: the controller's lifetime follows the session. While the
 * core creates the workspace of work just sent, it is that work's conversation: the instruction
 * as the first message, the working line, and a reply card that waits for the session (ADE motion,
 * "Starting work from the start screen"). The pane stays mounted when the session arrives, so
 * only what differs changes, in place.
 */
export function WorkspaceConversation(props: {
  /** The workspace and its session; null while the core creates the workspace. */
  workspaceId: string | null;
  sessionId: string | null;
  /** The instruction that started the work, when the view continues the starting workspace. */
  firstMessage?: string | undefined;
  /** Whether the session last ran in another mode and must reopen in the native conversation. */
  reopenNatively?: boolean;
  /** What the work just started without, when the core said so. */
  baseNotice?: { code: string; upstream: string | null } | null;
}) {
  const intl = useIntl();
  const host = useSessionHost();
  const { workspaceId, sessionId, firstMessage, reopenNatively = false } = props;
  const source = useMemo(
    () =>
      workspaceId === null || sessionId === null
        ? new StandInConversation(firstMessage ?? "")
        : new ConversationController(host, {
            workspaceId,
            sessionId,
            reopenNatively,
            ...(firstMessage === undefined ? {} : { firstMessage }),
          }),
    [host, workspaceId, sessionId, firstMessage, reopenNatively],
  );
  const working = useWorkspaceStore(
    (store) => sessionId !== null && visibleStatus(store.statuses[sessionId]) === "working",
  );
  const activity = useConversationStore(useShallow((store) => activityOf(store.window)));
  const starting = sessionId === null;
  // A session host older than the application ends the connection on `session.interrupt`, and
  // only a core that advertises `decoder.interrupt` can stop a turn.
  const hostIsCurrent = useHostIsCurrent();
  const coreStops = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("decoder.interrupt") === true,
  );
  // Only a core that advertises `turn.summary` keeps the records a turn summary reads.
  const commands = useApplicationCommands();
  const coreSummarizes = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("turn.summary") === true,
  );
  const summarize = useMemo(
    () =>
      workspaceId === null || sessionId === null || !coreSummarizes
        ? undefined
        : async (window: { startedAtMs: number; endedAtMs?: number }) => {
            const result = await commands.run("turn.summary", { workspaceId, turns: [window] });
            return result.turns[0] ?? null;
          },
    [commands, workspaceId, sessionId, coreSummarizes],
  );
  // The source asked to stop: the working line says so until the turn ends, which its notice
  // confirms. It resets during render when the turn ends or the conversation changes.
  const [stopped, setStopped] = useState<ConversationSource | null>(null);
  if (stopped !== null && (!working || stopped !== source)) setStopped(null);
  const stopping = stopped === source;
  const stop = async () => {
    setStopped(source);
    try {
      await source.interrupt();
    } catch (failure) {
      setStopped(null);
      throw failure;
    }
  };
  const label = intl.formatMessage(
    starting
      ? activityMessages.starting
      : stopping
        ? activityMessages.stopping
        : activityMessages[activity.kind],
    !stopping && activity.kind === "tool" ? { name: activity.name } : {},
  );
  return (
    <ConversationPane
      source={source}
      working={starting || working ? label : null}
      draftKey={workspaceId === null ? undefined : `reply:${workspaceId}`}
      waiting={starting ? intl.formatMessage({ id: "conversation.reply.starting" }) : undefined}
      onStop={working && !starting && !stopping && hostIsCurrent && coreStops ? stop : undefined}
      continues={firstMessage !== undefined}
      summarize={summarize}
      notice={
        /* motion: Lervo notices in the conversation */
        props.baseNotice === undefined || props.baseNotice === null ? null : (
          <BaseNotice code={props.baseNotice.code} upstream={props.baseNotice.upstream} />
        )
      }
    />
  );
}
