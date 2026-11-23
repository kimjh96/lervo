import { motion } from "../../../design/generated/motion";

/** How long newly arrived text takes to appear in full; also the most a stream ever trails. */
export const PACE_MS = motion.paceMs;

/**
 * How much of a streaming text to show after a frame of `elapsedMs`, given that `shown`
 * characters are on screen and `msLeft` remain until all of the text should be. The rest is
 * revealed evenly over the time left, so a burst flows in over a few frames instead of appearing
 * at once, and nothing trails the text that arrived by more than `PACE_MS`. It never splits a
 * surrogate pair.
 */
export function nextShown(text: string, shown: number, elapsedMs: number, msLeft: number): number {
  const length = text.length;
  if (shown >= length) return length;
  const share = msLeft <= elapsedMs ? 1 : elapsedMs / msLeft;
  let next = Math.min(length, shown + Math.max(1, Math.ceil((length - shown) * share)));
  const code = text.charCodeAt(next - 1);
  if (code >= 0xd800 && code <= 0xdbff && next < length) next += 1;
  return next;
}
