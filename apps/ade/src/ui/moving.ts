import { useEffect, useState } from "react";

import { motion } from "../design/generated/motion";

/**
 * The rows that moved to another place: keys new in `next` whose item `previous` already listed
 * under another key, such as a conversation that was pinned.
 */
export function movedOf<T>(
  previous: readonly T[],
  next: readonly T[],
  keyOf: (item: T) => string,
  idOf: (item: T) => string,
): ReadonlySet<string> {
  const keys = new Set(previous.map(keyOf));
  const ids = new Set(previous.map(idOf));
  return new Set(next.filter((item) => !keys.has(keyOf(item)) && ids.has(idOf(item))).map(keyOf));
}

/**
 * The rows that moved while the person watched, for `motion.duration.enter`. A list gives a row
 * that changes its place a key of that place, so the row leaves where it was, through
 * `useDepartingInPlace`, and arrives at its new place with its space (ADE motion, "Moving a row"):
 * the rows around it slide, and none jumps.
 */
export function useMoved<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  idOf: (item: T) => string,
): ReadonlySet<string> {
  const signature = items.map(keyOf).join("\n");
  const [seen, setSeen] = useState({ signature, items });
  const [moved, setMoved] = useState<ReadonlySet<string>>(() => new Set());
  if (seen.signature !== signature) {
    setSeen({ signature, items });
    setMoved(movedOf(seen.items, items, keyOf, idOf));
  }
  useEffect(() => {
    if (moved.size === 0) return;
    const timer = setTimeout(() => setMoved(new Set()), motion.enterMs);
    return () => clearTimeout(timer);
  }, [moved]);
  return moved;
}
