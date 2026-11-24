import { useEffect, useState } from "react";

import { motion } from "../design/generated/motion";

/**
 * The items that left a list and still fade out: those that were in `previous` or already leaving,
 * and are not in `next`. An item that returns stops leaving.
 */
export function departedOf<T>(
  previous: readonly T[],
  next: readonly T[],
  leaving: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const present = new Set(next.map(keyOf));
  const departed = new Map<string, T>();
  for (const item of [...leaving, ...previous])
    if (!present.has(keyOf(item))) departed.set(keyOf(item), item);
  return [...departed.values()];
}

/**
 * Keeps the items that leave a list for `motion.duration.leave`, so they fade out where they were
 * instead of dropping out (ADE motion, "Coming and going"). Returns the departed items, which the
 * list shows marked as leaving beside the current ones.
 */
export function useDeparting<T>(items: readonly T[], keyOf: (item: T) => string): readonly T[] {
  const [seen, setSeen] = useState(items);
  const [departed, setDeparted] = useState<readonly T[]>([]);
  if (seen !== items) {
    setSeen(items);
    setDeparted(departedOf(seen, items, departed, keyOf));
  }
  const leaving = departed.map(keyOf).join(" ");
  useEffect(() => {
    if (leaving === "") return;
    const timer = setTimeout(() => setDeparted([]), motion.leaveMs);
    return () => clearTimeout(timer);
  }, [leaving]);
  return departed;
}
