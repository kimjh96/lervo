import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { ArrowUpIcon } from "../../../ui/icons";
import styles from "./Composer.module.css";

/** Lines the input grows to before it scrolls. */
const MAX_LINES = 8;

/**
 * The reply card (approved mockup "2a"). Enter sends; Shift+Enter starts a new line; composition
 * is respected. The input grows with its text, and a failed send puts the text back.
 */
export function Composer(props: { onSend: (text: string) => Promise<void> }) {
  const intl = useIntl();
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const element = input.current;
    if (element === null) return;
    element.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 22;
    element.style.height = `${Math.min(element.scrollHeight, lineHeight * MAX_LINES)}px`;
  }, [text]);
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
      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          ref={input}
          className={styles.input}
          aria-label={intl.formatMessage({ id: "conversation.reply.label" })}
          placeholder={intl.formatMessage({ id: "conversation.reply.placeholder" })}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keyDown}
        />
        <button
          type="submit"
          className={styles.send}
          disabled={text.trim().length === 0}
          aria-label={intl.formatMessage({ id: "conversation.reply.send" })}
        >
          <ArrowUpIcon size={16} />
        </button>
      </form>
      {failed ? (
        <p className={styles.error} role="alert">
          <FormattedMessage id="conversation.reply.failed" />
        </p>
      ) : null}
    </div>
  );
}
