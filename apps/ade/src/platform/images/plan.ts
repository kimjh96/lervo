// The sizes and formats a pasted image is tried at, smallest last, so the first one within the
// protocol's bound is sent. Pure, so tests hold it without a canvas.

/** The longest side Claude reads an image at; a larger image is scaled down before it is sent. */
export const MAX_IMAGE_SIDE = 1568;
/** The longest side a pasted image shrinks to at most while it stays over the bound. */
export const MIN_IMAGE_SIDE = 384;
const JPEG_QUALITY = 0.85;
const SHRINK = 0.75;

export interface Encoding {
  readonly mediaType: "image/png" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly quality?: number;
}

/** The size within `side` on the longest side, never larger than the image itself. */
export function fittedSize(
  width: number,
  height: number,
  side: number = MAX_IMAGE_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * PNG at the fitted size keeps text and edges exact; then JPEG, which is far smaller for photos
 * and large screenshots, at the fitted size and at each smaller step down to `MIN_IMAGE_SIDE`.
 */
export function* encodings(width: number, height: number): Generator<Encoding> {
  const fitted = fittedSize(width, height);
  yield { mediaType: "image/png", ...fitted };
  let side = Math.max(fitted.width, fitted.height);
  for (;;) {
    yield { mediaType: "image/jpeg", ...fittedSize(width, height, side), quality: JPEG_QUALITY };
    if (side <= MIN_IMAGE_SIDE) return;
    side = Math.max(MIN_IMAGE_SIDE, Math.round(side * SHRINK));
  }
}
