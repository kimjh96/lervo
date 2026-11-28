import type { ConversationItem } from "@lervo/session-host-contract";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { estimatedRowHeight } from "./row-estimate";

/** The key of the conversation's first row. */
const FIRST_ROW = "first-row";
const NEAR_EDGE_PX = 48;
/** The most frames a list stays hidden while its measured height settles. */
const PLACE_FRAMES = 12;
/** How close to the bottom counts as the live end, so a bounce at the bottom stays there. */
const LIVE_END_PX = 4;
/** How long after a wheel, key, or drag a scroll counts as the user's. */
const USER_SCROLL_MS = 300;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/**
 * The conversation's virtualized list, following its live end (ADE motion, "Following the
 * stream"): only items near the viewport mount, and their heights are measured once per item. The
 * newest text stays in view until the user scrolls up, by however little; the item the user reads
 * stays in place when items are added or dropped above it; and pages load near either edge. The
 * list is `placed` once its measured height settles at the end, so its first layout never shows.
 */
export function useFollowLatest(input: {
  scroller: RefObject<HTMLDivElement | null>;
  items: readonly ConversationItem[];
  hasEarlier: boolean;
  hasLater: boolean;
  /** Shows the list at once, when the view continues one already on screen. */
  continues: boolean;
  /** The floating dock's height, which the list keeps room for below its last item. */
  dockHeight: number;
  /** Counts the tool lines the user opened or closed, which must not move the view. */
  toggles: number;
  onLoadEarlier: () => void;
  onLoadLater: () => void;
}): {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  live: boolean;
  placed: "now" | "arrive" | null;
  follow: () => void;
} {
  const { scroller } = input;
  // The interface does not use the React Compiler, so the virtualizer's unmemoizable functions
  // need no compiler support.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: input.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => estimatedRowHeight(input.items[index]),
    // The conversation's first item keeps one key, so the session's copy of the first message
    // replaces the stand-in of work just sent in place instead of mounting its row again.
    getItemKey: (index) =>
      index === 0 && !input.hasEarlier ? FIRST_ROW : (input.items[index]?.itemId ?? index),
    overscan: 8,
    // A conversation grows at its end and loads earlier pages at its start, so the virtualizer
    // keeps the item the reader is on in place whenever items are added or dropped around it, in
    // the same step that tracks its own scroll offset. The view's own correction of an earlier
    // page, run after the virtualizer's, moved the view against it (2026-11-28).
    anchorTo: "end",
  });
  /** The position the view last scrolled to itself, whose scroll event is not the user's. */
  const selfScrolled = useRef<number | null>(null);
  const loaders = useRef(input);
  loaders.current = input;
  const [following, setFollowing] = useState(true);
  const [placed, setPlaced] = useState<"now" | "arrive" | null>(null);
  const placedNow = useRef(placed);
  placedNow.current = placed;
  const hasItems = input.items.length > 0;
  const live = following && !input.hasLater;
  const liveNow = useRef(live);
  liveNow.current = live;
  const last = input.items.at(-1);
  const lastLength = last !== undefined && "text" in last ? last.text.length : 0;
  const totalSize = virtualizer.getTotalSize();
  /** The list's height when the user last opened or closed a tool line, until it is measured. */
  const toggledAt = useRef<number | null>(null);

  // A tool line the user opens or closes stays under the pointer, so the next measured height
  // does not move the view to the end.
  useLayoutEffect(() => {
    if (input.toggles > 0) toggledAt.current = virtualizer.getTotalSize();
  }, [input.toggles, virtualizer]);

  // While following, the newest text stays in view as items arrive and heights are measured.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!live || element === null) return;
    if (toggledAt.current !== null) {
      if (totalSize === toggledAt.current) return;
      toggledAt.current = null;
      // The opened line leaves the end below the view: the user is reading, and the view stops
      // following until they return to the end. A line closed at the end stays at the end.
      if (element.scrollHeight - element.scrollTop - element.clientHeight > LIVE_END_PX)
        setFollowing(false);
      return;
    }
    element.scrollTop = element.scrollHeight;
    selfScrolled.current = element.scrollTop;
    // Until the list is placed, the virtualizer reads the end now rather than from the next
    // frame's scroll event, so the end's rows mount and are measured before the first paint.
    if (placedNow.current === null) element.dispatchEvent(new Event("scroll"));
  }, [scroller, live, input.items.length, lastLength, totalSize, input.dockHeight]);

  // The list shows once its items are measured and it rests at its end, so the estimated first
  // layout and the scroll to the end never show; it then arrives with the view. A list that
  // continues one already on screen, such as new work's first message, shows at once.
  useLayoutEffect(() => {
    if (placed !== null || !hasItems) return;
    // `lervo:` marks time each step of opening a conversation for the interface harness.
    performance.mark("lervo:conversation-rows");
    if (input.continues) {
      setPlaced("now");
      return;
    }
    // Each frame follows the end until the measured height stops changing. The height at layout
    // counts as the first, so a list measured in its first commit is placed after one frame.
    let frames = 0;
    let previous = scroller.current?.scrollHeight ?? -1;
    let frame = 0;
    const settle = () => {
      const element = scroller.current;
      if (element === null) return;
      if (liveNow.current) {
        element.scrollTop = element.scrollHeight;
        selfScrolled.current = element.scrollTop;
      }
      frames += 1;
      if (element.scrollHeight === previous || frames >= PLACE_FRAMES) {
        performance.mark("lervo:conversation-placed");
        setPlaced("arrive");
      } else frame = requestAnimationFrame(settle);
      previous = element.scrollHeight;
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [scroller, placed, hasItems, input.continues]);

  useUserScroll({ scroller, selfScrolled, loaders, setFollowing });

  return { virtualizer, live, placed, follow: () => setFollowing(true) };
}

/**
 * Tells the user's scrolls from the view's own (ADE motion, "Following the stream"): only the
 * user leaves the live end, by moving up with a wheel, a key, or the scroll bar, by however
 * little; reaching the bottom returns to it, whatever moved the view there. It also loads pages
 * near either edge.
 */
function useUserScroll(input: {
  scroller: RefObject<HTMLDivElement | null>;
  /** The position the view last scrolled to itself, whose scroll event is not the user's. */
  selfScrolled: RefObject<number | null>;
  loaders: RefObject<{ onLoadEarlier: () => void; onLoadLater: () => void }>;
  setFollowing: (following: boolean) => void;
}): void {
  const { scroller, selfScrolled, loaders, setFollowing } = input;
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    let dragging = false;
    let userAt = Number.NEGATIVE_INFINITY;
    let previousTop = element.scrollTop;
    // Only the user leaves the live end, by moving up with a wheel, a key, or the scroll bar, by
    // however little. Scrolls the view makes itself, such as following new text or correcting
    // measured heights, never count. The user returns to the live end by reaching the bottom.
    const user = () => (userAt = performance.now());
    const key = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) user();
    };
    const press = () => {
      dragging = true;
      user();
    };
    const release = () => (dragging = false);
    const scrolled = () => {
      const top = element.scrollTop;
      const movedUp = top < previousTop;
      previousTop = top;
      const own = selfScrolled.current !== null && Math.abs(top - selfScrolled.current) < 1;
      selfScrolled.current = null;
      const byUser = !own && (dragging || performance.now() - userAt < USER_SCROLL_MS);
      const bottom = element.scrollHeight - top - element.clientHeight;
      // At the bottom the view is at the live end, whatever moved it there.
      if (bottom <= LIVE_END_PX) setFollowing(true);
      else if (byUser && movedUp) setFollowing(false);
      if (bottom < NEAR_EDGE_PX) loaders.current.onLoadLater();
      if (top < NEAR_EDGE_PX) loaders.current.onLoadEarlier();
    };
    element.addEventListener("scroll", scrolled, { passive: true });
    element.addEventListener("wheel", user, { passive: true });
    element.addEventListener("keydown", key);
    element.addEventListener("pointerdown", press);
    globalThis.addEventListener("pointerup", release);
    return () => {
      element.removeEventListener("scroll", scrolled);
      element.removeEventListener("wheel", user);
      element.removeEventListener("keydown", key);
      element.removeEventListener("pointerdown", press);
      globalThis.removeEventListener("pointerup", release);
    };
  }, [scroller, selfScrolled, loaders, setFollowing]);
}
