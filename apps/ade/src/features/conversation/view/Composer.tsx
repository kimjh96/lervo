import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { failureCode, type PreparedImage } from "../../../ports";
import { IconButton } from "../../../ui/IconButton";
import { ImageTray } from "../../../ui/ImageTray";
import { ArrowUpIcon, StopIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { InputCard, InputField } from "../../../ui/InputCard";
import { Presence } from "../../../ui/Presence";
import styles from "./Composer.module.css";
import { useOpenImages } from "./ConversationImages";
import { useDraft } from "./draft";
import { imageNoticeValues, usePastedImages } from "./pasted-images";

/** Lines the input grows to before it scrolls. */
const MAX_LINES = 8;

/**
 * The reply card (approved mockup "2a"). Enter sends; Shift+Enter starts a new line; composition
 * is respected. The input grows with its text, keeps it as a draft under `draftKey`, and a failed
 * send puts the text back. While the agent's turn can be stopped, the empty card's button stops
 * it and Escape does too; typed text turns the button back into send, so a reply can still go.
 * Pasted images wait as thumbnails above the field and go with the next reply, which may be images
 * alone (image mockup, "1").
 */
export function Composer(props: {
  onSend: (text: string, images: readonly PreparedImage[]) => Promise<void>;
  /** Stops the agent's running turn, while it can be stopped. */
  onStop?: (() => Promise<void>) | undefined;
  draftKey?: string | undefined;
  /** Shown in place of the placeholder while replies cannot be sent yet. */
  waiting?: string | undefined;
  /** Whether the session host and the core carry images in a reply. */
  acceptsImages?: boolean | undefined;
}) {
  const intl = useIntl();
  const open = useOpenImages();
  const [text, setText] = useDraft(props.draftKey);
  const [failure, setFailure] = useState<{ id: string; code: string } | null>(null);
  const images = usePastedImages({
    accepts: props.acceptsImages === true,
    resetKey: props.draftKey,
  });
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
  const empty = text.trim().length === 0 && images.ready.length === 0;
  const stops = stop !== undefined && empty && !images.preparing;
  const send = () => {
    const value = text.trim();
    if ((value.length === 0 && images.ready.length === 0) || images.preparing) return;
    const sending = images.take();
    setText("");
    setFailure(null);
    images.clearNotice();
    props.onSend(value, sending).catch((error: unknown) => {
      setText(value);
      images.restore(sending);
      setFailure({ id: "conversation.reply.failed", code: failureCode(error) });
    });
  };
  const tray = images.tray(intl);
  return (
    // Paste reaches the card from its field, where the person pastes.
    <div className={styles.composer} onPaste={images.paste}>
      <InputCard
        surface="floating"
        layout="inline"
        onSubmit={send}
        attachments={
          /* motion: Coming and going */
          tray.length === 0 ? undefined : (
            <ImageTray
              images={tray}
              removeLabel={(index) =>
                intl.formatMessage({ id: "conversation.images.remove" }, { number: index + 1 })
              }
              onRemove={images.remove}
              onOpen={(index) => open(tray, index)}
            />
          )
        }
      >
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
          disabled={!stops && (empty || images.preparing)}
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
        {failure === null ? (
          images.notice === null ? null : (
            <InlineAlert size="meta">
              <FormattedMessage {...images.notice} values={imageNoticeValues} />
            </InlineAlert>
          )
        ) : (
          <InlineAlert size="meta">
            <FormattedMessage id={failure.id} values={{ code: failure.code }} />
          </InlineAlert>
        )}
      </Presence>
    </div>
  );
}
