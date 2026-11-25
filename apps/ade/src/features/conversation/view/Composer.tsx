import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { failureCode } from "../../../ports";
import { IconButton } from "../../../ui/IconButton";
import { ArrowUpIcon, StopIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { InputCard, InputField } from "../../../ui/InputCard";
import { Presence } from "../../../ui/Presence";
import styles from "./Composer.module.css";
import { useDraft } from "./draft";

/** Lines the input grows to before it scrolls. */
const MAX_LINES = 8;

/**
 * The reply card (approved mockup "2a"). Enter sends; Shift+Enter starts a new line; composition
 * is respected. The input grows with its text, keeps it as a draft under `draftKey`, and a failed
 * send puts the text back. While the agent's turn can be stopped, the empty card's button stops
 * it and Escape does too; typed text turns the button back into send, so a reply can still go.
 */
export function Composer(props: {
  onSend: (text: string) => Promise<void>;
  /** Stops the agent's running turn, while it can be stopped. */
  onStop?: (() => Promise<void>) | undefined;
  draftKey?: string | undefined;
  /** Shown in place of the placeholder while replies cannot be sent yet. */
  waiting?: string | undefined;
}) {
  const intl = useIntl();
  const [text, setText] = useDraft(props.draftKey);
  const [failure, setFailure] = useState<{ id: string; code: string } | null>(null);
  const { onStop } = props;
  const stop =
    onStop === undefined
      ? undefined
      : () => {
          setFailure(null);
          onStop().catch((error: unknown) => {
            setFailure({ id: "conversation.stop.failed", code: failureCode(error) });
          });
        };
  const stops = stop !== undefined && text.trim().length === 0;
  const send = () => {
    const value = text.trim();
    if (value.length === 0) return;
    setText("");
    setFailure(null);
    props.onSend(value).catch((error: unknown) => {
      setText(value);
      setFailure({ id: "conversation.reply.failed", code: failureCode(error) });
    });
  };
  return (
    <div className={styles.composer}>
      <InputCard surface="floating" layout="inline" onSubmit={send}>
        <InputField
          size="body"
          rows={1}
          maxLines={MAX_LINES}
          label={intl.formatMessage({ id: "conversation.reply.label" })}
          placeholder={
            props.waiting ?? intl.formatMessage({ id: "conversation.reply.placeholder" })
          }
          disabled={props.waiting !== undefined}
          value={text}
          onChange={setText}
          onSubmit={send}
          onEscape={stop}
        />
        {/* The button stays; its icon changes in place. */}
        <IconButton
          type={stops ? "button" : "submit"}
          disabled={!stops && text.trim().length === 0}
          label={
            stops
              ? intl.formatMessage({ id: "conversation.stop" })
              : intl.formatMessage({ id: "conversation.reply.send" })
          }
          icon={
            <Presence as="span" contentKey={stops ? "stop" : "send"}>
              {stops ? <StopIcon size="lg" /> : <ArrowUpIcon size="lg" />}
            </Presence>
          }
          onClick={stops ? stop : undefined}
        />
      </InputCard>
      <Presence className={styles.error}>
        {failure === null ? null : (
          <InlineAlert size="meta">
            <FormattedMessage id={failure.id} values={{ code: failure.code }} />
          </InlineAlert>
        )}
      </Presence>
    </div>
  );
}
