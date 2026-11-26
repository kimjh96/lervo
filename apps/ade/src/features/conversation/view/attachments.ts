import { MAX_SENT_IMAGES } from "@lervo/session-host-contract";
import { type ClipboardEvent, useEffect, useState } from "react";
import { type IntlShape, type MessageDescriptor } from "react-intl";
import { useStore } from "zustand";

import { type AttachedFile, type PreparedImage, useFiles, useImages } from "../../../ports";
import type { TrayFile, TrayImage } from "../../../ui/AttachmentTray";
import {
  type AttachmentNotice,
  type AttachmentPorts,
  Attachments,
  nothing,
} from "../model/attachments";
import {
  type SizeUnit,
  baseName,
  extension,
  fileSize,
  folderName,
  MAX_ATTACHED_FILES,
} from "../model/files";

/** Each notice's words, as the line under the card says it. */
const notices = {
  unsupported: { id: "conversation.images.unsupported" },
  tooMany: { id: "conversation.images.tooMany" },
  image_unreadable: { id: "conversation.images.unreadable" },
  image_too_large: { id: "conversation.images.tooLarge" },
  tooManyFiles: { id: "conversation.files.tooMany" },
} as const satisfies Record<AttachmentNotice, MessageDescriptor>;

/** The values every notice formats with: the limits it names. */
export const attachmentNoticeValues = { count: MAX_SENT_IMAGES, files: MAX_ATTACHED_FILES };

/** An image's bytes as a webview address while it is prepared. */
const objectPreview: AttachmentPorts["preview"] = (blob) => {
  const url = URL.createObjectURL(blob);
  return { url, release: () => URL.revokeObjectURL(url) };
};

/**
 * An input card's attachments (`model/attachments.ts`) as the card uses them: paste and drop,
 * what the tray shows, and the notice under the card. Everything belongs to the card's
 * `resetKey`, such as its conversation.
 */
export function useAttachments(options: {
  acceptsImages: boolean;
  resetKey: string | undefined;
  /** What the card starts with, such as what a failed start returned. */
  initialImages?: readonly PreparedImage[];
  initialFiles?: readonly AttachedFile[];
}) {
  const images = useImages();
  const files = useFiles();
  const cardKey = options.resetKey;
  const { acceptsImages } = options;
  const [attachments] = useState(
    () =>
      new Attachments(
        { images, files, preview: objectPreview },
        {
          key: cardKey,
          ...(options.initialImages === undefined ? {} : { images: options.initialImages }),
          ...(options.initialFiles === undefined ? {} : { files: options.initialFiles }),
        },
      ),
  );
  useEffect(() => attachments.follow(cardKey), [attachments, cardKey]);
  const state = useStore(attachments.store);
  const waiting = state.key === cardKey ? state.waiting : nothing;

  const paste = (event: ClipboardEvent<HTMLElement>) => {
    const data = event.clipboardData;
    if (!data.types.includes("Files")) return;
    // A paste that carries files never means their names, or an image's address, as text.
    event.preventDefault();
    attachments.paste(cardKey, [...data.files], acceptsImages);
  };

  return {
    notice: state.notice === null ? null : notices[state.notice],
    clearNotice: () => attachments.notify(null),
    paste,
    drop: (paths: readonly string[]) => attachments.drop(cardKey, paths, acceptsImages),
    /** Whether any image is still being prepared, so the card waits to send. */
    preparing: waiting.images.some((item) => item.image === undefined),
    /** Whether anything is ready to go, so the card may send without text. */
    holds: waiting.images.some((item) => item.image !== undefined) || waiting.files.length > 0,
    remove: (key: string) => attachments.remove(cardKey, key),
    /** The path of the waiting file under `key`, which its chip shows in Finder. */
    pathOf: (key: string) => waiting.files.find((item) => `file-${item.id}` === key)?.file.path,
    /** Takes what is ready for sending; the card empties. */
    take: () => attachments.take(cardKey),
    /** Puts back what a failed send took. */
    restore: (taken: { images: readonly PreparedImage[]; files: readonly AttachedFile[] }) =>
      attachments.restore(cardKey, taken),
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

/** Each size unit's words. */
const SIZE_UNITS: Readonly<Record<SizeUnit, MessageDescriptor>> = {
  B: { id: "conversation.files.size.B" },
  KB: { id: "conversation.files.size.KB" },
  MB: { id: "conversation.files.size.MB" },
  GB: { id: "conversation.files.size.GB" },
  TB: { id: "conversation.files.size.TB" },
};

/** A size in the locale's numbers, such as "84 KB" or "1.2 MB". */
function sizeText(intl: IntlShape, size: ReturnType<typeof fileSize>): string {
  const value = intl.formatNumber(size.value, { maximumFractionDigits: size.decimals });
  return intl.formatMessage(SIZE_UNITS[size.unit], { value });
}

/** A waiting file as its chip shows it: the folder it is in, and its size or that it is a folder. */
function trayFile(intl: IntlShape, key: string, file: AttachedFile): TrayFile {
  const folder = folderName(file.path);
  const kind = file.directory
    ? intl.formatMessage({ id: "conversation.files.folder" })
    : file.size === null
      ? "none"
      : sizeText(intl, fileSize(file.size));
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
