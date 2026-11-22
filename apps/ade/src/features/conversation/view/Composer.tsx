import { type KeyboardEvent, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import styles from "./Composer.module.css";

/** The reply input. Enter sends; Shift+Enter starts a new line; composition is respected. */
export function Composer(props: { onSend: (text: string) => Promise<void> }) {
  const intl = useIntl();
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const send = () => {
    const value = text.trim();
    if (value.length === 0) return;
    setText("");
    setFailed(false);
    props.onSend(value).catch(() => {
      setText(value);
      setFailed(true);
    });
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <div className={styles.composer}>
      <textarea
        className={styles.input}
        aria-label={intl.formatMessage({ id: "conversation.reply.label" })}
        placeholder={intl.formatMessage({ id: "conversation.reply.placeholder" })}
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keyDown}
      />
      {failed ? (
        <p className={styles.error} role="alert">
          <FormattedMessage id="conversation.reply.failed" />
        </p>
      ) : null}
    </div>
  );
}
