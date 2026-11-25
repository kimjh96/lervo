import { MAX_SENT_IMAGES } from "@lervo/session-host-contract";
import { type ClipboardEvent, useState } from "react";
import { FormattedMessage, type MessageDescriptor, useIntl } from "react-intl";

import { failureCode, ImageFailure, type PreparedImage, useImages } from "../../../ports";
import { Button } from "../../../ui/Button";
import { IconButton } from "../../../ui/IconButton";
import { ArrowUpIcon, CloseIcon, StopIcon } from "../../../ui/icons";
import { InlineAlert } from "../../../ui/InlineAlert";
import { InputCard, InputField } from "../../../ui/InputCard";
import { Presence } from "../../../ui/Presence";
import styles from "./Composer.module.css";
import { useDraft } from "./draft";

/** Lines the input grows to before it scrolls. */
const MAX_LINES = 8;

/** Why a pasted image was not added, as the line under the card says. */
const imageNotices = {
  unsupported: { id: "conversation.images.unsupported" },
  tooMany: { id: "conversation.images.tooMany" },
  image_unreadable: { id: "conversation.images.unreadable" },
  image_too_large: { id: "conversation.images.tooLarge" },
} as const satisfies Record<string, MessageDescriptor>;

interface Attached {
  readonly id: number;
  readonly image: PreparedImage;
}

let attachedCount = 0;

/**
 * The reply card (approved mockup "2a"). Enter sends; Shift+Enter starts a new line; composition
 * is respected. The input grows with its text, keeps it as a draft under `draftKey`, and a failed
 * send puts the text back. While the agent's turn can be stopped, the empty card's button stops
 * it and Escape does too; typed text turns the button back into send, so a reply can still go.
 * Pasted images wait above the card as quiet lines, each with its remove button, and go with the
 * next reply; a reply may be images alone (Lervo ADE sessions, "Images in a message").
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
  const preparer = useImages();
  const [text, setText] = useDraft(props.draftKey);
  const [failure, setFailure] = useState<{ id: string; code: string } | null>(null);
  // Images belong to the conversation they were pasted into; another conversation starts empty.
  const [images, setImages] = useState<{ key: string | undefined; attached: Attached[] }>({
    key: props.draftKey,
    attached: [],
  });
  if (images.key !== props.draftKey) setImages({ key: props.draftKey, attached: [] });
  const attached = images.key === props.draftKey ? images.attached : [];
  const [preparing, setPreparing] = useState(0);
  const [notice, setNotice] = useState<MessageDescriptor | null>(null);
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
  const empty = text.trim().length === 0 && attached.length === 0;
  const stops = stop !== undefined && empty && preparing === 0;
  const attach = (adding: (current: Attached[]) => Attached[]) =>
    setImages((current) => ({ key: current.key, attached: adding(current.attached) }));
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    // A copied image often carries its address as text too; the image is what was meant.
    event.preventDefault();
    setNotice(null);
    if (props.acceptsImages !== true) {
      setNotice(imageNotices.unsupported);
      return;
    }
    const room = MAX_SENT_IMAGES - attached.length - preparing;
    if (files.length > room) setNotice(imageNotices.tooMany);
    for (const file of files.slice(0, Math.max(room, 0))) {
      setPreparing((count) => count + 1);
      preparer
        .prepare(file)
        .then(
          (image) => {
            attachedCount += 1;
            const id = attachedCount;
            attach((current) => [...current, { id, image }]);
          },
          (error: unknown) =>
            setNotice(
              error instanceof ImageFailure
                ? imageNotices[error.code]
                : imageNotices.image_unreadable,
            ),
        )
        .finally(() => setPreparing((count) => count - 1));
    }
  };
  const send = () => {
    const value = text.trim();
    if ((value.length === 0 && attached.length === 0) || preparing > 0) return;
    const sending = attached;
    setText("");
    attach(() => []);
    setFailure(null);
    setNotice(null);
    props
      .onSend(
        value,
        sending.map((item) => item.image),
      )
      .catch((error: unknown) => {
        setText(value);
        attach((current) => [...sending, ...current]);
        setFailure({ id: "conversation.reply.failed", code: failureCode(error) });
      });
  };
  return (
    // Paste reaches the card from its field, where the person pastes.
    <div className={styles.composer} onPaste={paste}>
      <Presence className={styles.images}>
        {/* motion: Coming and going */}
        {attached.length === 0 && preparing === 0 ? null : (
          <ul className={styles.imageList}>
            {attached.map((item, index) => (
              <li key={item.id} className={styles.image}>
                <FormattedMessage
                  id="conversation.images.attached"
                  values={{ number: index + 1, width: item.image.width, height: item.image.height }}
                />
                <Button
                  variant="quiet"
                  label={intl.formatMessage(
                    { id: "conversation.images.remove" },
                    { number: index + 1 },
                  )}
                  onClick={() =>
                    attach((current) => current.filter((other) => other.id !== item.id))
                  }
                >
                  <CloseIcon size="sm" />
                </Button>
              </li>
            ))}
            {/* motion: Coming and going */}
            {preparing === 0 ? null : (
              <li className={styles.image}>
                <FormattedMessage id="conversation.images.preparing" />
              </li>
            )}
          </ul>
        )}
      </Presence>
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
          disabled={!stops && (empty || preparing > 0)}
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
          notice === null ? null : (
            <InlineAlert size="meta">
              <FormattedMessage {...notice} values={{ count: MAX_SENT_IMAGES }} />
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
