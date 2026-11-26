import { MAX_SENT_IMAGES } from "@lervo/session-host-contract";
import { type ClipboardEvent, useEffect, useRef, useState } from "react";
import { type IntlShape, type MessageDescriptor } from "react-intl";
import { createStore, useStore } from "zustand";

import {
  type AttachedFile,
  ImageFailure,
  type PreparedImage,
  useFiles,
  useImages,
} from "../../../ports";
import type { TrayFile, TrayImage } from "../../../ui/AttachmentTray";
import {
  baseName,
  extension,
  fileSize,
  folderName,
  isAttachablePath,
  isImagePath,
  MAX_ATTACHED_FILES,
} from "../model/files";
import { dataUrl } from "../model/images";

/** Why something pasted or dropped was not added, as the line under the card says. */
const notices = {
  unsupported: { id: "conversation.images.unsupported" },
  tooMany: { id: "conversation.images.tooMany" },
  image_unreadable: { id: "conversation.images.unreadable" },
  image_too_large: { id: "conversation.images.tooLarge" },
  tooManyFiles: { id: "conversation.files.tooMany" },
} as const satisfies Record<string, MessageDescriptor>;

/** The values every notice formats with: the limits it names. */
export const attachmentNoticeValues = { count: MAX_SENT_IMAGES, files: MAX_ATTACHED_FILES };

/** An image in a card: its preview, and the prepared image once it is ready. */
interface WaitingImage {
  readonly id: number;
  readonly preview: string;
  readonly image?: PreparedImage;
}

interface WaitingFile {
  readonly id: number;
  readonly file: AttachedFile;
}

interface Waiting {
  readonly images: readonly WaitingImage[];
  readonly files: readonly WaitingFile[];
}

/** What a card holds, under the key it belongs to. */
interface Held {
  readonly key: string | undefined;
  readonly waiting: Waiting;
}

const nothing: Waiting = { images: [], files: [] };

let added = 0;
const next = () => {
  added += 1;
  return added;
};

const readyImage = (image: PreparedImage): WaitingImage => ({
  id: next(),
  image,
  preview: dataUrl(image.mediaType, image.data),
});

/**
 * What waits in an input card to go with its text (Lervo ADE sessions, "Images in a message" and
 * "Files in a message"). A pasted or dropped image shows at once, faint while it is prepared, and
 * then as the image that will be sent. Any other file waits as a chip and goes as its path, which
 * the agent reads itself; a dropped image goes as a path too when the session takes no images.
 * Everything belongs to the card's `resetKey`, such as its conversation: another key starts empty.
 */
export function useAttachments(options: {
  acceptsImages: boolean;
  resetKey: string | undefined;
  /** What the card starts with, such as what a failed start returned. */
  initialImages?: readonly PreparedImage[];
  initialFiles?: readonly AttachedFile[];
}) {
  const preparer = useImages();
  const files = useFiles();
  // An external store, so additions that arrive together each see the ones before them.
  const [store] = useState(() =>
    createStore<Held>(() => ({
      key: options.resetKey,
      waiting: {
        images: (options.initialImages ?? []).map(readyImage),
        files: (options.initialFiles ?? []).map((file) => ({ id: next(), file })),
      },
    })),
  );
  const holding = useStore(store);
  const cardKey = options.resetKey;
  const waiting = holding.key === cardKey ? holding.waiting : nothing;
  const latestKey = useRef(cardKey);
  useEffect(() => {
    latestKey.current = cardKey;
  });
  const [notice, setNotice] = useState<MessageDescriptor | null>(null);
  /** What the card holds now, as later additions must see it. */
  const now = (): Waiting => {
    const state = store.getState();
    return state.key === cardKey ? state.waiting : nothing;
  };
  const update = (change: (waiting: Waiting) => Waiting) => {
    // A preparation that ends after the card turned to another key changes nothing.
    if (cardKey !== latestKey.current) return;
    store.setState({ key: cardKey, waiting: change(now()) });
  };

  const addImage = (source: Blob | Promise<Blob>) => {
    Promise.resolve(source).then(
      (blob) => {
        if (now().images.length >= MAX_SENT_IMAGES) {
          setNotice(notices.tooMany);
          return;
        }
        const id = next();
        const preview = URL.createObjectURL(blob);
        update((held) => ({ ...held, images: [...held.images, { id, preview }] }));
        preparer
          .prepare(blob)
          .then(
            (image) =>
              update((held) => ({
                ...held,
                images: held.images.map((item) =>
                  item.id === id
                    ? { id, image, preview: dataUrl(image.mediaType, image.data) }
                    : item,
                ),
              })),
            (error: unknown) => {
              update((held) => ({
                ...held,
                images: held.images.filter((item) => item.id !== id),
              }));
              setNotice(
                error instanceof ImageFailure ? notices[error.code] : notices.image_unreadable,
              );
            },
          )
          .finally(() => URL.revokeObjectURL(preview));
      },
      () => setNotice(notices.image_unreadable),
    );
  };

  const addFile = (file: AttachedFile) => {
    const kept = now().files;
    if (!isAttachablePath(file.path) || kept.some((item) => item.file.path === file.path)) return;
    if (kept.length >= MAX_ATTACHED_FILES) {
      setNotice(notices.tooManyFiles);
      return;
    }
    update((all) => ({ ...all, files: [...all.files, { id: next(), file }] }));
  };

  /** Files the shell describes: images go as images when the session takes them. */
  const addDescribed = (described: readonly AttachedFile[], skipImages: ReadonlySet<string>) => {
    for (const file of described) {
      if (!file.exists) continue;
      if (!file.directory && isImagePath(file.path) && options.acceptsImages) {
        if (!skipImages.has(file.name)) addImage(files.readImage(file.path));
      } else addFile(file);
    }
  };

  const paste = (event: ClipboardEvent<HTMLElement>) => {
    const data = event.clipboardData;
    if (!data.types.includes("Files")) return;
    // A paste that carries files never means their names, or an image's address, as text.
    event.preventDefault();
    setNotice(null);
    const pasted = [...data.files];
    const images = pasted.filter((file) => file.type.startsWith("image/"));
    if (images.length > 0 && !options.acceptsImages && pasted.length === images.length) {
      // Images without a file, such as a screenshot, go only as images.
      void files.pasted().then((described) => {
        if (described.length === 0) setNotice(notices.unsupported);
        else addDescribed(described, new Set());
      });
      return;
    }
    if (options.acceptsImages) for (const image of images) addImage(image);
    if (pasted.length === images.length && options.acceptsImages) return;
    // Files copied in Finder: the shell reads their paths from the clipboard.
    const named = new Set(options.acceptsImages ? images.map((image) => image.name) : []);
    void files.pasted().then((described) => addDescribed(described, named));
  };

  const drop = (paths: readonly string[]) => {
    setNotice(null);
    void files.describe(paths).then((described) => addDescribed(described, new Set()));
  };

  const readyImages = waiting.images.flatMap((item) =>
    item.image === undefined ? [] : [item.image],
  );
  const attachedFiles = waiting.files.map((item) => item.file);
  return {
    notice,
    clearNotice: () => setNotice(null),
    paste,
    drop,
    /** Whether any image is still being prepared, so the card waits to send. */
    preparing: waiting.images.some((item) => item.image === undefined),
    /** Whether anything is ready to go, so the card may send without text. */
    holds: readyImages.length > 0 || attachedFiles.length > 0,
    remove: (key: string) =>
      update((held) => ({
        images: held.images.filter((item) => `image-${item.id}` !== key),
        files: held.files.filter((item) => `file-${item.id}` !== key),
      })),
    /** The path of the waiting file under `key`, which its chip shows in Finder. */
    pathOf: (key: string) => waiting.files.find((item) => `file-${item.id}` === key)?.file.path,
    /** Takes what is ready for sending; the card empties. */
    take: (): { images: PreparedImage[]; files: AttachedFile[] } => {
      update(() => nothing);
      return { images: readyImages, files: attachedFiles };
    },
    /** Puts back what a failed send took. */
    restore: (taken: { images: readonly PreparedImage[]; files: readonly AttachedFile[] }) =>
      update((held) => ({
        images: [...taken.images.map(readyImage), ...held.images],
        files: [...taken.files.map((file) => ({ id: next(), file })), ...held.files],
      })),
    /** What waits, as the card's tray shows it. */
    tray: (intl: IntlShape): { images: TrayImage[]; files: TrayFile[] } => ({
      images: waiting.images.map((item, index) => ({
        key: `image-${item.id}`,
        src: item.preview,
        preparing: item.image === undefined,
        removeLabel: intl.formatMessage(
          { id: "conversation.images.remove" },
          { number: index + 1 },
        ),
        alt:
          item.image === undefined
            ? intl.formatMessage({ id: "conversation.images.preparing" }, { number: index + 1 })
            : intl.formatMessage(
                { id: "conversation.images.attached" },
                { number: index + 1, width: item.image.width, height: item.image.height },
              ),
      })),
      files: waiting.files.map(({ id, file }) => trayFile(intl, `file-${id}`, file)),
    }),
  };
}

/** A waiting file as its chip shows it: the folder it is in, and its size or that it is a folder. */
function trayFile(intl: IntlShape, key: string, file: AttachedFile): TrayFile {
  const folder = folderName(file.path);
  const kind = file.directory
    ? intl.formatMessage({ id: "conversation.files.folder" })
    : file.size === null
      ? "none"
      : fileSize(file.size);
  return {
    key,
    name: file.name,
    badge: extension(file.name).slice(0, 4).toUpperCase(),
    folder: file.directory,
    detail: intl.formatMessage({ id: "conversation.files.detail" }, { folder, kind }),
    label: intl.formatMessage({ id: "conversation.files.label" }, { name: file.name, folder }),
    removeLabel: intl.formatMessage(
      { id: "conversation.files.remove" },
      { name: baseName(file.path) },
    ),
  };
}
