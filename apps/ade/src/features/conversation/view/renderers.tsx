import type { ConversationItem } from "@lervo/session-host-contract";
import { type ComponentType, lazy, type ReactNode, Suspense } from "react";
import { FormattedMessage, type MessageDescriptor } from "react-intl";

import { attachedFiles } from "../model/files";
import { QuestionChoices } from "./ChoiceCard";
import { ClaimLine } from "./ClaimLine";
import { MessageFiles } from "./MessageFiles";
import { MessageImages } from "./MessageImages";
import { usePacedText } from "./paced";
import styles from "./renderers.module.css";
import { ToolLine } from "./ToolLine";
import { MentionText } from "../../agents";
import { useWorkspaceStore } from "../../workspaces";

type Renderer<Kind extends ConversationItem["kind"]> = ComponentType<{
  item: Extract<ConversationItem, { kind: Kind }>;
}>;

// The Markdown renderer loads as its own chunk as soon as the interface starts, so the start
// screen's JavaScript stays within its budget and a conversation rarely waits for it.
const loading = import("./markdown/Markdown");
const Markdown = lazy(() => loading);

/** Text split at blank lines, one paragraph each, while the Markdown renderer loads. */
function Paragraphs(props: { text: string; className: string | undefined }) {
  const paragraphs = props.text.split(/\n{2,}/u);
  return (
    <div className={props.className}>
      {paragraphs.map((paragraph, index) => (
        // Paragraphs have no identity beyond their order within one immutable message.
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

/**
 * The user's message in its bubble, with the images it carried and then the files it named above
 * its text (approved image mockup, "A"; file mockup, "A"; Lervo ADE sessions, "Images in a
 * message" and "Files in a message").
 */
function UserMessage({ item }: { item: Extract<ConversationItem, { kind: "user_message" }> }) {
  const images = item.images ?? [];
  const { text, paths } = attachedFiles(item.text);
  if (images.length === 0 && paths.length === 0)
    return (
      <p className={styles.user}>
        <MentionText text={text} />
      </p>
    );
  return (
    <div className={styles.user}>
      {/* motion: A message arrives live */}
      {images.length === 0 ? null : (
        <MessageImages images={images} alone={text.length === 0 && paths.length === 0} />
      )}
      {/* motion: A message arrives live */}
      {paths.length === 0 ? null : <MessageFiles paths={paths} />}
      {/* motion: A message arrives live */}
      {text.length === 0 ? null : (
        <p className={styles.userText}>
          <MentionText text={text} />
        </p>
      )}
    </div>
  );
}

/** An agent's text as Markdown, as plain paragraphs until the renderer has loaded. */
function AgentText(props: { text: string; className: string | undefined }) {
  return (
    <div className={props.className}>
      <Suspense fallback={<Paragraphs text={props.text} className={undefined} />}>
        <Markdown text={props.text} />
      </Suspense>
    </div>
  );
}

function AgentMessage({ item }: { item: Extract<ConversationItem, { kind: "agent_message" }> }) {
  const text = usePacedText(item.text);
  return <AgentText text={text} className={styles.agent} />;
}

function Question({ item }: { item: Extract<ConversationItem, { kind: "question" }> }) {
  const { choices } = item;
  if (choices === undefined) return <AgentText text={item.text} className={styles.question} />;
  return (
    <QuestionChoices
      item={{ ...item, choices }}
      text={(text) => <AgentText text={text} className={styles.agent} />}
    />
  );
}

/**
 * The text of each Lervo notice code the interface knows. The core's codes are an open set, so
 * an unknown code shows the generic notice with the code.
 */
const noticeMessages: Readonly<Record<string, MessageDescriptor>> = {
  conversation_item_invalid: { id: "notice.conversation_item_invalid" },
  core_decoding_failed: { id: "notice.core_decoding_failed" },
  core_link_unavailable: { id: "notice.core_link_unavailable" },
  provider_turn_failed: { id: "notice.provider_turn_failed" },
  turn_stopped: { id: "notice.turn_stopped" },
};

/**
 * Where the provider compacted the conversation: a thin divider, not a notice line, because the
 * conversation above it is what the agent no longer holds word for word.
 */
function CompactionDivider({ manual }: { manual: boolean }) {
  return (
    <p className={styles.divider} role="separator">
      <FormattedMessage
        id="notice.context_compacted"
        values={{ trigger: manual ? "manual" : "auto" }}
      />
    </p>
  );
}

/**
 * What a conversation's room did (Lervo ADE rooms, "The ADE"): a quiet line without a mark or a
 * source, like a tool line, because it records the agents' coordination rather than speaking.
 */
const roomMessages: Readonly<Record<string, MessageDescriptor>> = {
  room_joined: { id: "room.joined" },
  room_paused: { id: "room.paused" },
  room_delivery_failed: { id: "room.deliveryFailed" },
  room_rejoin_failed: { id: "room.rejoinFailed" },
  claim_deferred: { id: "room.claimDeferred" },
};

/**
 * A room line that names another conversation, which it opens (Lervo ADE rooms, "How an agent
 * starts a conversation"): the one an agent started from here, or the one this was started in.
 */
const startedMessages: Readonly<Record<string, MessageDescriptor>> = {
  conversation_started: { id: "room.conversationStarted" },
  conversation_started_by: { id: "room.conversationStartedBy" },
};

function StartedLine({ item }: { item: Extract<ConversationItem, { kind: "lervo_notice" }> }) {
  const workspaceId = String(item.parameters.workspace ?? "");
  const known = useWorkspaceStore((store) =>
    store.workspaces.find((workspace) => workspace.workspaceId === workspaceId),
  );
  const select = useWorkspaceStore((store) => store.select);
  const title =
    item.code === "conversation_started"
      ? String(item.parameters.title ?? "")
      : (known?.title ?? known?.branch ?? null);
  const agent = String(item.parameters.agent ?? "");
  if (title === null)
    return (
      <p className={styles.roomLine}>
        <FormattedMessage id="room.conversationStartedByElsewhere" values={{ agent }} />
      </p>
    );
  const link = (chunks: ReactNode) => (
    <button
      type="button"
      className={styles.roomLink}
      disabled={known === undefined}
      onClick={() => select(workspaceId)}
    >
      {chunks}
    </button>
  );
  return (
    <p className={styles.roomLine}>
      <FormattedMessage {...startedMessages[item.code]} values={{ agent, title, link }} />
    </p>
  );
}

function LervoNotice({ item }: { item: Extract<ConversationItem, { kind: "lervo_notice" }> }) {
  if (item.code === "context_compacted")
    return <CompactionDivider manual={item.parameters.trigger === "manual"} />;
  if (Object.hasOwn(startedMessages, item.code)) return <StartedLine item={item} />;
  if (item.code === "claim_conflict") return <ClaimLine item={item} />;
  if (Object.hasOwn(roomMessages, item.code))
    return (
      <p className={styles.roomLine}>
        <FormattedMessage {...roomMessages[item.code]} values={{ ...item.parameters }} />
      </p>
    );
  const message = Object.hasOwn(noticeMessages, item.code)
    ? noticeMessages[item.code]
    : { id: "notice.unknown" };
  return (
    <p className={styles.notice}>
      <span className={styles.source}>
        <FormattedMessage id="app.name" />
      </span>
      <FormattedMessage {...message} values={{ ...item.parameters, code: item.code }} />
    </p>
  );
}

/**
 * A message another agent session sent this one: at the start of the line like the agent's words,
 * but framed and named, so it never reads as the person's message or the agent's own.
 */
function PeerMessage({ item }: { item: Extract<ConversationItem, { kind: "peer_message" }> }) {
  return (
    <div className={styles.peer}>
      <span className={styles.peerFrom}>
        <FormattedMessage id="conversation.peer.from" values={{ name: item.from }} />
      </span>
      <p className={styles.peerText}>{item.text}</p>
    </div>
  );
}

/**
 * The renderer of each item kind. A new kind adds a schema entry and a renderer here; the list
 * code does not change (ADE convention, "Extensibility and flexibility").
 */
const renderers: { [Kind in ConversationItem["kind"]]: Renderer<Kind> } = {
  user_message: UserMessage,
  agent_message: AgentMessage,
  question: Question,
  tool_activity: ToolLine,
  lervo_notice: LervoNotice,
  peer_message: PeerMessage,
};

export function ConversationItemView({ item }: { item: ConversationItem }) {
  const Render = renderers[item.kind] as Renderer<typeof item.kind>;
  return <Render item={item as never} />;
}
