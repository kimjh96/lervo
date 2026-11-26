// What waits in an input card to go with its text (Lervo ADE sessions, "Images in a message" and
// "Files in a message").
import { MAX_SENT_IMAGES } from "@lervo/session-host-contract";
import { createStore, type StoreApi } from "zustand";

import {
  type AttachedFile,
  type Files,
  ImageFailure,
  type Images,
  type PreparedImage,
} from "../../../ports";
import { isAttachablePath, isImagePath, MAX_ATTACHED_FILES } from "./files";
import { dataUrl } from "./images";

/** Why something pasted or dropped was not added, as the line under the card says. */
export type AttachmentNotice =
  "unsupported" | "tooMany" | "image_unreadable" | "image_too_large" | "tooManyFiles";

/** An image in a card: its preview, and the prepared image once it is ready. */
export interface WaitingImage {
  readonly id: number;
  readonly preview: string;
  readonly image?: PreparedImage;
}

export interface WaitingFile {
  readonly id: number;
  readonly file: AttachedFile;
}

export interface Waiting {
  readonly images: readonly WaitingImage[];
  readonly files: readonly WaitingFile[];
}

/** What a card holds under the key it belongs to, such as its conversation, and its notice. */
export interface AttachmentsState {
  readonly key: string | undefined;
  readonly waiting: Waiting;
  readonly notice: AttachmentNotice | null;
}

/** What a send takes from the card, and what a failed send puts back. */
export interface Taken {
  readonly images: readonly PreparedImage[];
  readonly files: readonly AttachedFile[];
}

/**
 * What the attachments need from the shell and the webview: the image and file ports, and a
 * preview of an image's bytes while it is prepared, released once it is.
 */
export interface AttachmentPorts {
  readonly images: Pick<Images, "prepare">;
  readonly files: Pick<Files, "pasted" | "describe" | "readImage">;
  readonly preview: (blob: Blob) => { readonly url: string; readonly release: () => void };
}

export const nothing: Waiting = { images: [], files: [] };

/**
 * A card's attachments. A pasted or dropped image shows at once, faint while it is prepared, and
 * then as the image that will be sent. Any other file waits as a chip and goes as its path, which
 * the agent reads itself; a dropped image goes as a path too when the session takes no images.
 * Everything belongs to the card's key: another key starts empty, and work that ends after the
 * card turned to another key changes nothing.
 */
export class Attachments {
  readonly store: StoreApi<AttachmentsState>;
  private current: string | undefined;
  private added = 0;

  constructor(
    private readonly ports: AttachmentPorts,
    initial: {
      key: string | undefined;
      images?: readonly PreparedImage[];
      files?: readonly AttachedFile[];
    },
  ) {
    this.current = initial.key;
    this.store = createStore<AttachmentsState>(() => ({
      key: initial.key,
      waiting: {
        images: (initial.images ?? []).map((image) => this.ready(image)),
        files: (initial.files ?? []).map((file) => ({ id: this.next(), file })),
      },
      notice: null,
    }));
  }

  /** The card now belongs to `key`, such as after it moved to another conversation. */
  follow(key: string | undefined): void {
    this.current = key;
  }

  /** What the card holds under `key`. */
  held(key: string | undefined): Waiting {
    const state = this.store.getState();
    return state.key === key ? state.waiting : nothing;
  }

  notify(notice: AttachmentNotice | null): void {
    this.store.setState({ notice });
  }

  /**
   * Files and images pasted together. Images without a file, such as a screenshot, go only as
   * images when the session takes them; otherwise the shell reads the clipboard's files, which
   * are what Finder copied.
   */
  paste(key: string | undefined, pasted: readonly File[], acceptsImages: boolean): void {
    this.notify(null);
    const images = pasted.filter((file) => file.type.startsWith("image/"));
    const onlyImages = pasted.length === images.length;
    if (images.length > 0 && !acceptsImages && onlyImages) {
      void this.ports.files.pasted().then((described) => {
        if (described.length === 0) this.notify("unsupported");
        else this.addDescribed(key, described, new Set(), acceptsImages);
      });
      return;
    }
    if (acceptsImages) for (const image of images) this.addImage(key, image);
    if (onlyImages && acceptsImages) return;
    const named = new Set(acceptsImages ? images.map((image) => image.name) : []);
    void this.ports.files
      .pasted()
      .then((described) => this.addDescribed(key, described, named, acceptsImages));
  }

  /** Paths dropped on the window. */
  drop(key: string | undefined, paths: readonly string[], acceptsImages: boolean): void {
    this.notify(null);
    void this.ports.files
      .describe(paths)
      .then((described) => this.addDescribed(key, described, new Set(), acceptsImages));
  }

  remove(key: string | undefined, itemKey: string): void {
    this.update(key, (held) => ({
      images: held.images.filter((item) => `image-${item.id}` !== itemKey),
      files: held.files.filter((item) => `file-${item.id}` !== itemKey),
    }));
  }

  /** Takes what is ready for sending; the card empties. */
  take(key: string | undefined): Taken {
    const held = this.held(key);
    this.update(key, () => nothing);
    return {
      images: held.images.flatMap((item) => (item.image === undefined ? [] : [item.image])),
      files: held.files.map((item) => item.file),
    };
  }

  /** Puts back what a failed send took, before what was added since. */
  restore(key: string | undefined, taken: Taken): void {
    this.update(key, (held) => ({
      images: [...taken.images.map((image) => this.ready(image)), ...held.images],
      files: [...taken.files.map((file) => ({ id: this.next(), file })), ...held.files],
    }));
  }

  /** Files the shell describes: images go as images when the session takes them. */
  private addDescribed(
    key: string | undefined,
    described: readonly AttachedFile[],
    skipImages: ReadonlySet<string>,
    acceptsImages: boolean,
  ): void {
    for (const file of described) {
      if (!file.exists) continue;
      if (!file.directory && isImagePath(file.path) && acceptsImages) {
        if (!skipImages.has(file.name)) this.addImage(key, this.ports.files.readImage(file.path));
      } else this.addFile(key, file);
    }
  }

  private addImage(key: string | undefined, source: Blob | Promise<Blob>): void {
    Promise.resolve(source).then(
      (blob) => {
        if (this.held(key).images.length >= MAX_SENT_IMAGES) {
          this.notify("tooMany");
          return;
        }
        const id = this.next();
        const preview = this.ports.preview(blob);
        this.update(key, (held) => ({
          ...held,
          images: [...held.images, { id, preview: preview.url }],
        }));
        this.ports.images
          .prepare(blob)
          .then(
            (image) =>
              this.update(key, (held) => ({
                ...held,
                images: held.images.map((item) =>
                  item.id === id
                    ? { id, image, preview: dataUrl(image.mediaType, image.data) }
                    : item,
                ),
              })),
            (failure: unknown) => {
              this.update(key, (held) => ({
                ...held,
                images: held.images.filter((item) => item.id !== id),
              }));
              this.notify(failure instanceof ImageFailure ? failure.code : "image_unreadable");
            },
          )
          .finally(preview.release);
      },
      () => this.notify("image_unreadable"),
    );
  }

  private addFile(key: string | undefined, file: AttachedFile): void {
    const kept = this.held(key).files;
    if (!isAttachablePath(file.path) || kept.some((item) => item.file.path === file.path)) return;
    if (kept.length >= MAX_ATTACHED_FILES) {
      this.notify("tooManyFiles");
      return;
    }
    this.update(key, (held) => ({ ...held, files: [...held.files, { id: this.next(), file }] }));
  }

  /** Changes what the card holds under `key`, unless the card has turned to another key. */
  private update(key: string | undefined, change: (held: Waiting) => Waiting): void {
    if (key !== this.current) return;
    this.store.setState({ key, waiting: change(this.held(key)) });
  }

  private ready(image: PreparedImage): WaitingImage {
    return { id: this.next(), image, preview: dataUrl(image.mediaType, image.data) };
  }

  private next(): number {
    this.added += 1;
    return this.added;
  }
}
