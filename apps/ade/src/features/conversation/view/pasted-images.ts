import { MAX_SENT_IMAGES } from "@lervo/session-host-contract";
import { type ClipboardEvent, useState } from "react";
import { type IntlShape, type MessageDescriptor } from "react-intl";

import { ImageFailure, type PreparedImage, useImages } from "../../../ports";
import type { TrayImage } from "../../../ui/ImageTray";
import { dataUrl } from "../model/images";

/** Why a pasted image was not added, as the line under the card says. */
const imageNotices = {
  unsupported: { id: "conversation.images.unsupported" },
  tooMany: { id: "conversation.images.tooMany" },
  image_unreadable: { id: "conversation.images.unreadable" },
  image_too_large: { id: "conversation.images.tooLarge" },
} as const satisfies Record<string, MessageDescriptor>;

/** A pasted image in a card: its preview, and the prepared image once it is ready. */
interface Waiting {
  readonly id: number;
  readonly preview: string;
  readonly image?: PreparedImage;
}

let pasted = 0;

/**
 * Images pasted into an input card, waiting to go with its text (Lervo ADE sessions, "Images in a
 * message"). A pasted image shows at once from the file, faint while it is prepared, and then as
 * the image that will be sent. They belong to the card's `resetKey`, such as its conversation:
 * another key starts empty.
 */
export function usePastedImages(options: {
  accepts: boolean;
  resetKey: string | undefined;
  /** Images the card starts with, such as those of a start that failed. */
  initial?: readonly PreparedImage[];
}) {
  const preparer = useImages();
  const [state, setState] = useState<{ key: string | undefined; waiting: readonly Waiting[] }>(
    () => ({
      key: options.resetKey,
      waiting: (options.initial ?? []).map((image) => {
        pasted += 1;
        return { id: pasted, image, preview: dataUrl(image.mediaType, image.data) };
      }),
    }),
  );
  if (state.key !== options.resetKey) setState({ key: options.resetKey, waiting: [] });
  const waiting = state.key === options.resetKey ? state.waiting : [];
  const [notice, setNotice] = useState<MessageDescriptor | null>(null);
  const update = (change: (current: readonly Waiting[]) => readonly Waiting[]) =>
    setState((current) => ({ key: current.key, waiting: change(current.waiting) }));

  const paste = (event: ClipboardEvent<HTMLElement>) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    // A copied image often carries its address as text too; the image is what was meant.
    event.preventDefault();
    setNotice(null);
    if (!options.accepts) {
      setNotice(imageNotices.unsupported);
      return;
    }
    const room = MAX_SENT_IMAGES - waiting.length;
    if (files.length > room) setNotice(imageNotices.tooMany);
    for (const file of files.slice(0, Math.max(room, 0))) {
      pasted += 1;
      const id = pasted;
      const preview = URL.createObjectURL(file);
      update((current) => [...current, { id, preview }]);
      preparer
        .prepare(file)
        .then(
          (image) =>
            update((current) =>
              current.map((item) =>
                item.id === id
                  ? { id, image, preview: dataUrl(image.mediaType, image.data) }
                  : item,
              ),
            ),
          (error: unknown) => {
            update((current) => current.filter((item) => item.id !== id));
            setNotice(
              error instanceof ImageFailure
                ? imageNotices[error.code]
                : imageNotices.image_unreadable,
            );
          },
        )
        .finally(() => URL.revokeObjectURL(preview));
    }
  };

  const ready = waiting.flatMap((item) => (item.image === undefined ? [] : [item.image]));
  return {
    notice,
    clearNotice: () => setNotice(null),
    paste,
    /** Whether any pasted image is still being prepared, so the card waits to send. */
    preparing: waiting.some((item) => item.image === undefined),
    /** The images ready to send. */
    ready,
    remove: (key: string) => update((current) => current.filter((item) => String(item.id) !== key)),
    /** Takes the ready images for sending; the card empties. */
    take: (): PreparedImage[] => {
      update(() => []);
      return ready;
    },
    /** Puts images back, such as after a failed send. */
    restore: (images: readonly PreparedImage[]) =>
      update((current) => [
        ...images.map((image) => {
          pasted += 1;
          return { id: pasted, image, preview: dataUrl(image.mediaType, image.data) };
        }),
        ...current,
      ]),
    /** The waiting images as the card's tray shows them. */
    tray: (intl: IntlShape): TrayImage[] =>
      waiting.map((item, index) => ({
        key: String(item.id),
        src: item.preview,
        preparing: item.image === undefined,
        alt:
          item.image === undefined
            ? intl.formatMessage({ id: "conversation.images.preparing" }, { number: index + 1 })
            : intl.formatMessage(
                { id: "conversation.images.attached" },
                { number: index + 1, width: item.image.width, height: item.image.height },
              ),
      })),
  };
}

/** The values a notice from `usePastedImages` formats with. */
export const imageNoticeValues = { count: MAX_SENT_IMAGES };
