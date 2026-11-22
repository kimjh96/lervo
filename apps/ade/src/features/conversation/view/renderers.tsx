import type { ConversationItem } from "@lervo/session-host-contract";
import type { ComponentType } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import styles from "./renderers.module.css";

type Renderer<Kind extends ConversationItem["kind"]> = ComponentType<{
  item: Extract<ConversationItem, { kind: Kind }>;
}>;

function UserMessage({ item }: { item: Extract<ConversationItem, { kind: "user_message" }> }) {
  return <p className={styles.user}>{item.text}</p>;
}

function AgentMessage({ item }: { item: Extract<ConversationItem, { kind: "agent_message" }> }) {
  return <p className={styles.agent}>{item.text}</p>;
}

function Question({ item }: { item: Extract<ConversationItem, { kind: "question" }> }) {
  return <p className={styles.question}>{item.text}</p>;
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
