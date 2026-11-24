import { FormattedMessage, type MessageDescriptor } from "react-intl";

import styles from "./renderers.module.css";

/**
 * The text of each base notice the interface knows. The core's notices are an open set, so an
 * unknown one shows the generic text with its code.
 */
const messages: Readonly<Record<string, MessageDescriptor>> = {
  base_unresolved: { id: "notice.workspace_base.base_unresolved" },
  no_upstream: { id: "notice.workspace_base.no_upstream" },
  fetch_failed: { id: "notice.workspace_base.fetch_failed" },
  knowledge_state_unreadable: { id: "notice.workspace_base.knowledge_state_unreadable" },
  replay_incomplete: { id: "notice.workspace_base.replay_incomplete" },
};

/**
 * What the work just started without, told after the fact (Lervo ADE sessions, "The workspace's
 * base"): a Lervo notice, like those in the conversation, such as the upstream it could not fetch.
 */
export function BaseNotice(props: { code: string; upstream: string | null }) {
  const message = Object.hasOwn(messages, props.code)
    ? messages[props.code]
    : { id: "notice.workspace_base.unknown" };
  return (
    <p className={styles.notice} role="status">
      <span className={styles.source}>
        <FormattedMessage id="app.name" />
      </span>
      <FormattedMessage
        {...message}
        values={{ code: props.code, upstream: props.upstream ?? "the upstream" }}
      />
    </p>
  );
}
