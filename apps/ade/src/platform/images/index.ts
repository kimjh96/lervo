import { MAX_SENT_IMAGE_CHARACTERS } from "@lervo/session-host-contract";

import { ImageFailure, type Images, type PreparedImage } from "../../ports/images";
import { encodings, MAX_MARK_BYTES, markSquare } from "./plan";

const MARK_JPEG_QUALITY = 0.85;

/** Base64 of a blob's bytes, in slices so a large image never builds one huge argument list. */
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

async function bitmapOf(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file).catch(() => {
    throw new ImageFailure("image_unreadable");
  });
}

/** The image's center square drawn `side` pixels a side; JPEG draws on white. */
async function square(
  bitmap: ImageBitmap,
  side: number,
  type: "image/png" | "image/jpeg",
): Promise<Blob> {
  const crop = markSquare(bitmap.width, bitmap.height, { min: side, max: side });
  const canvas = new OffscreenCanvas(side, side);
  const context = canvas.getContext("2d");
  if (context === null) throw new ImageFailure("image_unreadable");
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, side, side);
  }
  context.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, side, side);
  return canvas.convertToBlob(
    type === "image/jpeg" ? { type, quality: MARK_JPEG_QUALITY } : { type },
  );
}

/**
 * Images prepared with the webview's canvas: drawn at the first size and format of the plan whose
 * Base64 fits the protocol's bound. A JPEG step draws on white, since JPEG keeps no transparency.
 */
export function canvasImages(): Images {
  return {
    async prepare(file): Promise<PreparedImage> {
      const bitmap = await bitmapOf(file);
      try {
        for (const step of encodings(bitmap.width, bitmap.height)) {
          const canvas = new OffscreenCanvas(step.width, step.height);
          const context = canvas.getContext("2d");
          if (context === null) throw new ImageFailure("image_unreadable");
          if (step.mediaType === "image/jpeg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, step.width, step.height);
          }
          context.drawImage(bitmap, 0, 0, step.width, step.height);
          const blob = await canvas.convertToBlob({
            type: step.mediaType,
            ...(step.quality === undefined ? {} : { quality: step.quality }),
          });
          const data = await base64(blob);
          if (data.length <= MAX_SENT_IMAGE_CHARACTERS)
            return { mediaType: step.mediaType, data, width: step.width, height: step.height };
        }
        throw new ImageFailure("image_too_large");
      } finally {
        bitmap.close();
      }
    },
    async prepareMark(file) {
      const bitmap = await bitmapOf(file);
      try {
        const side = markSquare(bitmap.width, bitmap.height).drawn;
        for (const type of ["image/png", "image/jpeg"] as const) {
          const blob = await square(bitmap, side, type);
          if (blob.size <= MAX_MARK_BYTES) return base64(blob);
        }
        throw new ImageFailure("image_too_large");
      } finally {
        bitmap.close();
      }
    },
    async thumbnail(file, side) {
      const bitmap = await bitmapOf(file);
      try {
        return `data:image/png;base64,${await base64(await square(bitmap, side, "image/png"))}`;
      } finally {
        bitmap.close();
      }
    },
  };
}
