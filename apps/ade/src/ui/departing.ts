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
  // Compared by their keys, so a list rebuilt on every render, such as an input card's tray,
  // changes only when an item comes or goes.
  const signature = items.map(keyOf).join("\n");
  const [seen, setSeen] = useState({ signature, items });
  const [departed, setDeparted] = useState<readonly T[]>([]);
  if (seen.signature !== signature) {
    setSeen({ signature, items });
    setDeparted(departedOf(seen.items, items, departed, keyOf));
  }
  const leaving = departed.map(keyOf).join(" ");
  useEffect(() => {
    if (leaving === "") return;
    const timer = setTimeout(() => setDeparted([]), motion.leaveMs);
    return () => clearTimeout(timer);
  }, [leaving]);
  return departed;
}

/** An item as a list shows it: still listed, or leaving where it was. */
export interface ShownItem<T> {
  readonly item: T;
  readonly leaving: boolean;
}

/**
 * The current items in their order, with each departed item kept right after the item it followed
 * in the list as last shown, so a removed row fades out in its own place instead of jumping to the
 * end first.
 */
export function placeDeparted<T>(
  previous: readonly ShownItem<T>[],
  items: readonly T[],
  departed: readonly T[],
  keyOf: (item: T) => string,
): ShownItem<T>[] {
  const leaving = new Map(departed.map((item) => [keyOf(item), item]));
  const shown: ShownItem<T>[] = items.map((item) => ({ item, leaving: false }));
  previous.forEach((entry, index) => {
    const item = leaving.get(keyOf(entry.item));
    if (item === undefined) return;
    let at = 0;
    for (let back = index - 1; back >= 0; back -= 1) {
      const before = keyOf(previous[back]!.item);
      const found = shown.findIndex((candidate) => keyOf(candidate.item) === before);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    shown.splice(at, 0, { item, leaving: true });
    leaving.delete(keyOf(item));
  });
  // A departed item the list never showed, such as one removed in the same change it was added
  // in, leaves at the end.
  for (const item of leaving.values()) shown.push({ item, leaving: true });
  return shown;
}

/**
 * The list as shown: its items, with those that left still fading out where they were (ADE motion,
 * "Coming and going"). Rows pair it with `useItemSpace` so their space closes as they fade.
 */
export function useDepartingInPlace<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly ShownItem<T>[] {
  const departed = useDeparting(items, keyOf);
  const signature = [...items, ...departed].map(keyOf).join("\n");
  const [state, setState] = useState(() => ({
    signature,
    order: placeDeparted([], items, departed, keyOf),
  }));
  if (state.signature !== signature) {
    // Placed from the list as last shown, during render, as `useDeparting` tracks its items.
    const order = placeDeparted(state.order, items, departed, keyOf);
    setState({ signature, order });
    return order;
  }
  // The same items, perhaps rebuilt: the rows show the current ones in the kept order.
  const current = new Map(items.map((item) => [keyOf(item), item]));
  return state.order.map((entry) =>
    entry.leaving ? entry : { item: current.get(keyOf(entry.item)) ?? entry.item, leaving: false },
  );
}
