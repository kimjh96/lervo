import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { failureCode, type PreparedImage, useFiles } from "../../../ports";
import { IconButton } from "../../../ui/IconButton";
import { AttachmentTray } from "../../../ui/AttachmentTray";
import { ArrowUpIcon, StopIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { InputCard, InputField } from "../../../ui/InputCard";
import { Presence } from "../../../ui/Presence";
import styles from "./Composer.module.css";
import { withAttachedFiles } from "../model/files";
import { attachmentNoticeValues, useAttachments } from "./attachments";
import { useOpenImages } from "./ConversationImages";
import { useDraft } from "./draft";
import { useFileDrop } from "./file-drop";

/** Lines the input grows to before it scrolls. */
const MAX_LINES = 8;

/**
 * The reply card (approved mockup "2a"). Enter sends; Shift+Enter starts a new line; composition
 * is respected. The input grows with its text, keeps it as a draft under `draftKey`, and a failed
 * send puts the text back. While the agent's turn can be stopped, the empty card's button stops
 * it and Escape does too; typed text turns the button back into send, so a reply can still go.
 * Pasted images wait as thumbnails above the field and go with the next reply, which may be images
 * alone (image mockup, "1"). Other files, pasted or dropped anywhere on the window, wait as chips
 * beside them and go as their paths at the end of the text (file mockup, "A").
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
  const files = useFiles();
  const attachments = useAttachments({
    acceptsImages: props.acceptsImages === true,
    resetKey: props.draftKey,
  });
  const dragging = useFileDrop(attachments.drop);
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
  const empty = text.trim().length === 0 && !attachments.holds;
  const stops = stop !== undefined && empty && !attachments.preparing;
  const send = () => {
    const value = text.trim();
    if (empty || attachments.preparing) return;
    const sending = attachments.take();
    setText("");
    setFailure(null);
    attachments.clearNotice();
    const message = withAttachedFiles(
      value,
      sending.files.map((file) => file.path),
    );
    props.onSend(message, sending.images).catch((error: unknown) => {
      setText(value);
      attachments.restore(sending);
      setFailure({ id: "conversation.reply.failed", code: failureCode(error) });
    });
  };
  const tray = attachments.tray(intl);
  return (
    // Paste reaches the card from its field, where the person pastes.
    <div className={styles.composer} onPaste={attachments.paste}>
      <InputCard
        surface="floating"
        layout="inline"
        onSubmit={send}
        dropHint={dragging ? intl.formatMessage({ id: "conversation.files.drop" }) : undefined}
        attachments={
          /* motion: Coming and going */
          tray.images.length === 0 && tray.files.length === 0 ? undefined : (
            <AttachmentTray
              images={tray.images}
              files={tray.files}
              onRemove={attachments.remove}
              onOpenImage={(index) => open(tray.images, index)}
              onOpenFile={(key) => {
                const path = attachments.pathOf(key);
                if (path !== undefined) files.reveal(path);
              }}
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
          disabled={!stops && (empty || attachments.preparing)}
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
          attachments.notice === null ? null : (
            <InlineAlert size="meta">
              <FormattedMessage {...attachments.notice} values={attachmentNoticeValues} />
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
