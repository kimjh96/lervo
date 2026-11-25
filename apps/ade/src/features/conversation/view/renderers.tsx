import type { ConversationItem } from "@lervo/session-host-contract";
import { type ComponentType, lazy, Suspense } from "react";
import { FormattedMessage, type MessageDescriptor } from "react-intl";

import { MessageImages } from "./MessageImages";
import { usePacedText } from "./paced";
import styles from "./renderers.module.css";
import { ToolLine } from "./ToolLine";

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
 * The user's message in its bubble, with the images it carried above its text (approved image
 * mockup, "A"; Lervo ADE sessions, "Images in a message").
 */
function UserMessage({ item }: { item: Extract<ConversationItem, { kind: "user_message" }> }) {
  const images = item.images ?? [];
  if (images.length === 0) return <p className={styles.user}>{item.text}</p>;
  return (
    <div className={styles.user}>
      <MessageImages images={images} alone={item.text.length === 0} />
      {/* motion: A message arrives live */}
      {item.text.length === 0 ? null : <p className={styles.userText}>{item.text}</p>}
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
  return <AgentText text={item.text} className={styles.question} />;
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

function LervoNotice({ item }: { item: Extract<ConversationItem, { kind: "lervo_notice" }> }) {
  if (item.code === "context_compacted")
    return <CompactionDivider manual={item.parameters.trigger === "manual"} />;
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
