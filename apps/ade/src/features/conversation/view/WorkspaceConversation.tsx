import type { ImageMark } from "@lervo/session-host-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";

import {
  type ApplicationCommands,
  type PreparedImage,
  type SessionHost,
  useApplicationCommands,
  useSessionHost,
} from "../../../ports";
import { useHostIsCurrent } from "../../connection";
import { reloadWorkspaces, useWorkspaceStore, visibleStatus } from "../../workspaces";
import { activityOf } from "../model/activity";
import { ConversationController } from "../model/controller";
import { remember, sentImages } from "../model/images";
import { RoomMembers } from "../model/room-members";
import type { ConversationSource } from "../model/source";
import { StandInConversation } from "../model/stand-in-conversation";
import { useConversationStore } from "../model/store";
import { BaseNotice } from "./BaseNotice";
import { ConversationPane } from "./ConversationPane";
import { activityMessages } from "./messages";

/** How far before the send a reply's item may be stamped, by the core's clock. */
const QUEUED_SKEW_MS = 1_000;

/**
 * Gives the owner's turn to the agents it mentions beyond the lead (Lervo ADE rooms, "Routing"):
 * a joined agent's session, or a new one that joins with the turn. True when the lead is not among
 * them, so the turn does not go to the lead too.
 */
async function routeToMembers(input: {
  host: SessionHost;
  commands: ApplicationCommands;
  room: RoomMembers | null;
  workspaceId: string;
  leadAgentId: string;
  text: string;
}): Promise<boolean> {
  const { host, commands, room, workspaceId, leadAgentId, text } = input;
  const routed = await commands.run("room.route", { workspaceId, text }).catch(() => null);
  const agents = routed?.agents ?? [];
  const others = agents.filter((agentId) => agentId !== leadAgentId);
  for (const agentId of others) {
    const member = room?.sessionOf(agentId);
    const delivered =
      member !== undefined &&
      (await host
        .request({ kind: "session.send", sessionId: member, text })
        .then(() => true)
        .catch(() => false));
    if (delivered) continue;
    const joined = await commands.run("room.join", { workspaceId, agentId, instruction: text });
    room?.follow({ agentId, sessionId: joined.sessionId });
  }
  return others.length > 0 && !agents.includes(leadAgentId);
}

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
  /** The images pasted with that instruction. */
  firstImages?: readonly ImageMark[] | undefined;
  /** Whether the session last ran in another mode and must reopen in the native conversation. */
  reopenNatively?: boolean;
  /** What the work just started without, when the core said so. */
  baseNotice?: { code: string; upstream: string | null } | null;
}) {
  const intl = useIntl();
  const host = useSessionHost();
  const { workspaceId, sessionId, firstMessage, firstImages, reopenNatively = false } = props;
  const source = useMemo(
    () =>
      workspaceId === null || sessionId === null
        ? new StandInConversation(firstMessage ?? "", Date.now, firstImages)
        : new ConversationController(host, {
            workspaceId,
            sessionId,
            reopenNatively,
            ...(firstMessage === undefined ? {} : { firstMessage }),
            ...(firstImages === undefined ? {} : { firstImages }),
          }),
    [host, workspaceId, sessionId, firstMessage, firstImages, reopenNatively],
  );
  // A conversation's agents beyond its lead each have a session of their own (Lervo ADE rooms).
  const commands = useApplicationCommands();
  const coreRooms = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("room.route") === true,
  );
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((candidate) => candidate.workspaceId === workspaceId),
  );
  const leadAgentId = workspace?.agentId ?? null;
  const memberKey = (workspace?.sessions ?? [])
    .filter((session) => session.access === "read")
    .map((session) => `${session.agentId}=${session.sessionId}`)
    .join(",");
  const room = useRef<RoomMembers | null>(null);
  useEffect(() => {
    if (workspaceId === null || sessionId === null || !coreRooms) return;
    const created = new RoomMembers(host, commands, workspaceId, leadAgentId);
    room.current = created;
    return () => {
      created.close();
      if (room.current === created) room.current = null;
    };
  }, [host, commands, workspaceId, sessionId, coreRooms, leadAgentId]);
  useEffect(() => {
    for (const pair of memberKey === "" ? [] : memberKey.split(",")) {
      const [agentId = "", memberSession = ""] = pair.split("=");
      room.current?.follow({ agentId, sessionId: memberSession });
    }
  }, [memberKey, room]);
  // A session the list does not know, such as an agent's that just joined, refreshes the list,
  // which then names it among the conversation's sessions.
  const unknownSession = useWorkspaceStore((store) =>
    Object.keys(store.statuses).some(
      (id) =>
        !store.workspaces.some(
          (known) =>
            known.sessionId === id || known.sessions?.some((member) => member.sessionId === id),
        ),
    ),
  );
  useEffect(() => {
    if (unknownSession && coreRooms) void reloadWorkspaces(commands).catch(() => undefined);
  }, [unknownSession, coreRooms, commands]);
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
  const coreSummarizes = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("turn.summary") === true,
  );
  // A reply sent while the agent works waits for its next step; the time marks such replies until
  // the turn ends.
  const [queuedSince, setQueuedSince] = useState<number | null>(null);
  const [queuedFor, setQueuedFor] = useState(source);
  if ((!working || queuedFor !== source) && queuedSince !== null) {
    setQueuedSince(null);
    setQueuedFor(source);
  }
  const send = async (text: string, images: readonly PreparedImage[]) => {
    setQueuedSince(working ? Date.now() - QUEUED_SKEW_MS : null);
    setQueuedFor(source);
    // The bubble draws the images it carries from the cache, without asking the session host.
    await remember(images);
    const routed =
      workspaceId !== null && sessionId !== null && coreRooms && leadAgentId !== null
        ? await routeToMembers({
            host,
            commands,
            room: room.current,
            workspaceId,
            leadAgentId,
            text,
          })
        : false;
    if (routed) return;
    return source.send(text, sentImages(images));
  };
  // Only a core that advertises `decoder.images` carries images, through a current session host.
  const coreTakesImages = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("decoder.images") === true,
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
      onSend={send}
      acceptsImages={hostIsCurrent && coreTakesImages}
      queuedSince={queuedSince}
      notice={
        /* motion: Lervo notices in the conversation */
        props.baseNotice === undefined || props.baseNotice === null ? null : (
          <BaseNotice code={props.baseNotice.code} upstream={props.baseNotice.upstream} />
        )
      }
    />
  );
}
