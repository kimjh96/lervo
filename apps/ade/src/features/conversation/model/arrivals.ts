import { motion } from "../../../design/generated/motion";

/**
 * How long an item counts as arriving: its entrance and a frame's margin. A row that mounts later,
 * such as when the person scrolls back to it, no longer counts it, so loaded history never replays
 * an entrance (ADE motion, principle 8).
 */
export const ARRIVAL_MS = motion.enterMs + 50;

/** Removes `ids` from a set of arrivals, keeping the set itself when none of them is in it. */
export function withoutArrivals(
  arrived: ReadonlySet<string>,
  ids: ReadonlySet<string>,
): ReadonlySet<string> {
  return [...ids].some((id) => arrived.has(id))
    ? new Set([...arrived].filter((id) => !ids.has(id)))
    : arrived;
}

/** Forgets `ids` once their entrance has played, through `forget`. */
export function forgetArrivals(
  ids: readonly string[],
  forget: (ids: ReadonlySet<string>) => void,
): void {
  if (ids.length === 0) return;
  const done = new Set(ids);
  setTimeout(() => forget(done), ARRIVAL_MS);
}
