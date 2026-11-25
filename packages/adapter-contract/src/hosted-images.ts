// Images in a hosted native conversation's messages (Lervo ADE sessions, "Images in a message"):
// what a decoder writes for them, and the mark the conversation keeps of each.
import type { HostedDecodedEvent } from "./hosted-conversation.js";

export type HostedImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** An image sent with a message: its format and its bytes as Base64. */
export interface HostedSentImage {
  readonly mediaType: HostedImageMediaType;
  readonly data: string;
}

/** What the conversation keeps of an image: its format and size, never its bytes. */
export interface HostedImageMark {
  readonly mediaType: HostedImageMediaType;
  readonly width?: number;
  readonly height?: number;
}

/** A stream decoder that can carry images in the user's message. */
export interface HostedImageSending {
  /** The bytes for the provider's standard input, and what to show for the message. */
  sendWithImages(
    text: string,
    images: readonly HostedSentImage[],
  ): { readonly input: Uint8Array; readonly events: readonly HostedDecodedEvent[] };
}

/** Whether a decoder can carry images in a message. */
export function sendsImages(decoder: object): decoder is HostedImageSending {
  return typeof (decoder as Partial<HostedImageSending>).sendWithImages === "function";
}

/** Base64 characters read for an image's size: enough for any header, even behind EXIF data. */
const HEADER_CHARACTERS = 349_528;
const MAX_SIDE = 65_535;

/** Width and height from the image's own header, or undefined when it does not tell them. */
function size(
  mediaType: HostedImageMediaType,
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (offset: number, length: number) => offset + length <= bytes.length;
  if (mediaType === "image/png" && at(16, 8))
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (mediaType === "image/gif" && at(6, 4))
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (mediaType === "image/webp" && at(12, 4)) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === "VP8 " && at(26, 4))
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (chunk === "VP8L" && at(21, 4)) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X" && at(24, 6)) {
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width, height };
    }
    return undefined;
  }
  if (mediaType === "image/jpeg") {
    // The first start-of-frame marker holds the size; other segments are skipped by length.
    let offset = 2;
    while (at(offset, 4) && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);
      const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (frame && at(offset + 5, 4))
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
  }
  return undefined;
}

/** The mark for an image: its format and, when its header tells it, its size. */
export function imageMark(image: HostedSentImage): HostedImageMark {
  const head = image.data.slice(0, HEADER_CHARACTERS - (HEADER_CHARACTERS % 4));
  const measured = size(image.mediaType, Buffer.from(head, "base64"));
  const fits = (side: number) => Number.isInteger(side) && side >= 1 && side <= MAX_SIDE;
  return measured !== undefined && fits(measured.width) && fits(measured.height)
    ? { mediaType: image.mediaType, width: measured.width, height: measured.height }
    : { mediaType: image.mediaType };
}
