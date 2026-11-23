import type { ConversationItem } from "@lervo/session-host-contract";
import type { ComponentType } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import styles from "./renderers.module.css";

type Renderer<Kind extends ConversationItem["kind"]> = ComponentType<{
  item: Extract<ConversationItem, { kind: Kind }>;
}>;

/** Text split at blank lines, one paragraph each. Markdown rendering comes with S1.6c. */
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

function UserMessage({ item }: { item: Extract<ConversationItem, { kind: "user_message" }> }) {
  return <p className={styles.user}>{item.text}</p>;
}

function AgentMessage({ item }: { item: Extract<ConversationItem, { kind: "agent_message" }> }) {
  return <Paragraphs text={item.text} className={styles.agent} />;
}

function Question({ item }: { item: Extract<ConversationItem, { kind: "question" }> }) {
  return <Paragraphs text={item.text} className={styles.question} />;
}

function ToolActivity({ item }: { item: Extract<ConversationItem, { kind: "tool_activity" }> }) {
  return (
    <p className={styles.tool} data-status={item.tool.status}>
      <FormattedMessage
        id={`conversation.tool.${item.tool.status}`}
        values={{ name: item.tool.name, calls: item.tool.calls }}
      />
    </p>
  );
}

function LervoNotice({ item }: { item: Extract<ConversationItem, { kind: "lervo_notice" }> }) {
  const intl = useIntl();
  const id = `notice.${item.code}`;
  const known = id in intl.messages;
  return (
    <p className={styles.notice}>
      <span className={styles.source}>
        <FormattedMessage id="app.name" />
      </span>
      <FormattedMessage
        id={known ? id : "notice.unknown"}
        values={{ ...item.parameters, code: item.code }}
      />
    </p>
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
  tool_activity: ToolActivity,
  lervo_notice: LervoNotice,
};

export function ConversationItemView({ item }: { item: ConversationItem }) {
  const Render = renderers[item.kind] as Renderer<typeof item.kind>;
  return <Render item={item as never} />;
}
