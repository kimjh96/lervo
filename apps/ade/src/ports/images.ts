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
  /**
   * A project mark from an image: its center square, at most 512 pixels a side and at least 16,
   * as Base64 PNG, or JPEG when the PNG would pass the core's 512 KiB (Lervo ADE projects).
   * Rejects with an `ImageFailure`.
   */
  prepareMark(file: Blob): Promise<string>;
  /** A small copy of an image's center square, `side` pixels a side, as a PNG data URL. */
  thumbnail(file: Blob, side: number): Promise<string>;
}
