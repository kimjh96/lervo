import type { ImageMediaType } from "@lervo/session-host-contract";

/** A pasted image made ready to send: within the protocol's bound, as Base64, with its size. */
export interface PreparedImage {
  readonly mediaType: ImageMediaType;
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

/** Why an image could not be prepared: it is no image the system reads, or it stays too large. */
export class ImageFailure extends Error {
  constructor(readonly code: "image_unreadable" | "image_too_large") {
    super(code);
    this.name = "ImageFailure";
  }
}

/** Prepares pasted images for a message (Lervo ADE sessions, "Images in a message"). */
export interface Images {
  /** Rejects with an `ImageFailure`. */
  prepare(file: Blob): Promise<PreparedImage>;
}
