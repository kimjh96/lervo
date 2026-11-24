import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { failureCode } from "../../../ports";
import { IconButton } from "../../../ui/IconButton";
import { ArrowUpIcon } from "../../../ui/icons";
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
 * send puts the text back.
 */
export function Composer(props: {
  onSend: (text: string) => Promise<void>;
  draftKey?: string | undefined;
  /** Shown in place of the placeholder while replies cannot be sent yet. */
  waiting?: string | undefined;
}) {
  const intl = useIntl();
  const [text, setText] = useDraft(props.draftKey);
  const [failure, setFailure] = useState<string | null>(null);
  const send = () => {
    const value = text.trim();
    if (value.length === 0) return;
    setText("");
    setFailure(null);
    props.onSend(value).catch((error: unknown) => {
      setText(value);
      setFailure(failureCode(error));
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
        />
        <IconButton
          type="submit"
          disabled={text.trim().length === 0}
          label={intl.formatMessage({ id: "conversation.reply.send" })}
          icon={<ArrowUpIcon size="lg" />}
        />
      </InputCard>
      <Presence className={styles.error}>
        {failure === null ? null : (
          <InlineAlert size="meta">
            <FormattedMessage id="conversation.reply.failed" values={{ code: failure }} />
          </InlineAlert>
        )}
      </Presence>
    </div>
  );
}
