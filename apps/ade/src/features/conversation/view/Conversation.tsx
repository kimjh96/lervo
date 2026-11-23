import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FormattedMessage } from "react-intl";

import { useConversationStore } from "../model/store";
import styles from "./Conversation.module.css";
import { ConversationItemView } from "./renderers";

const NEAR_EDGE_PX = 48;
/** How close to the bottom counts as the live end, so a bounce at the bottom stays there. */
const LIVE_END_PX = 4;
/** How long after a wheel, key, or drag a scroll counts as the user's. */
const USER_SCROLL_MS = 300;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** Where the reader is: the first visible item and how far its top sits above the viewport. */
interface Anchor {
  readonly itemId: string;
  readonly offset: number;
}

/**
 * The native conversation, virtualized: only items near the viewport mount, and their heights
 * are measured once per item. It follows the live end until the user scrolls up, by however
 * little, and then offers "Jump to latest" (ADE motion, "Following the stream"). Pages load at either edge of the window,
 * and the item the user is reading stays in place when items are added or dropped above it.
 *
 * The conversation runs to the bottom of the window, and `dock`, such as the reply card, floats
 * over it on glass; the list keeps room for the dock below its last item.
 */
export function Conversation(props: {
  onLoadEarlier: () => void;
  onLoadLater: () => void;
  onJumpToLatest: () => void;
  dock: ReactNode;
}) {
  const window = useConversationStore((store) => store.window);
  const arrived = useConversationStore((store) => store.arrived);
  const scroller = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const items = useRef(window.items);
  items.current = window.items;
  const anchor = useRef<Anchor | null>(null);
  /** The position the view last scrolled to itself, whose scroll event is not the user's. */
  const selfScrolled = useRef<number | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const [following, setFollowing] = useState(true);
  const live = following && !window.hasLater;
  const liveNow = useRef(live);
  liveNow.current = live;
  // The interface does not use the React Compiler, so the virtualizer's unmemoizable functions
  // need no compiler support.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: window.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 72,
    getItemKey: (index) => window.items[index]?.itemId ?? index,
    overscan: 8,
  });
  const last = window.items.at(-1);
  const lastLength = last !== undefined && "text" in last ? last.text.length : 0;
  const totalSize = virtualizer.getTotalSize();
  const firstItemId = window.items[0]?.itemId;
  const firstShown = useRef(firstItemId);

  // The list keeps room below its last item for the dock, whose height follows the reply's text.
  useLayoutEffect(() => {
    const element = dock.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setDockHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // While following, the newest text stays in view as items arrive and heights are measured.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!live || element === null) return;
    element.scrollTop = element.scrollHeight;
    selfScrolled.current = element.scrollTop;
  }, [live, window.items.length, lastLength, totalSize, dockHeight]);

  // When items are added or dropped above the reader, the item they read stays where it was. Only
  // a change of the first item moves items; leaving the live end must not move the view.
  useLayoutEffect(() => {
    const previous = firstShown.current;
    firstShown.current = firstItemId;
    const element = scroller.current;
    const reading = anchor.current;
    if (previous === firstItemId || liveNow.current || element === null || reading === null) return;
    const index = items.current.findIndex((item) => item.itemId === reading.itemId);
    const start = virtualizer.measurementsCache[index]?.start;
    if (start === undefined) return;
    element.scrollTop = start + reading.offset;
    selfScrolled.current = element.scrollTop;
  }, [firstItemId, virtualizer]);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    let dragging = false;
    let userAt = Number.NEGATIVE_INFINITY;
    let previousTop = element.scrollTop;
    const remember = () => {
      const top = element.scrollTop;
      const row = virtualizer.getVirtualItems().find((candidate) => candidate.end > top);
      const item = row === undefined ? undefined : items.current[row.index];
      anchor.current =
        row === undefined || item === undefined
          ? null
          : { itemId: item.itemId, offset: top - row.start };
    };
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
      remember();
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
      if (bottom < NEAR_EDGE_PX) handlers.current.onLoadLater();
      if (top < NEAR_EDGE_PX) handlers.current.onLoadEarlier();
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
  }, [virtualizer]);

  const jump = () => {
    handlers.current.onJumpToLatest();
    setFollowing(true);
  };

  return (
    <div className={styles.frame} style={{ "--dock-height": `${dockHeight}px` } as CSSProperties}>
      {/* The log scrolls, so it takes keyboard focus for the arrow and page keys. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div ref={scroller} className={styles.scroller} role="log" aria-live="polite" tabIndex={0}>
        <div className={styles.list} style={{ height: totalSize }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = window.items[row.index];
            if (item === undefined) return null;
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                data-kind={item.kind}
                className={styles.row}
                data-arrived={arrived.has(item.itemId) ? "true" : undefined}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <ConversationItemView item={item} />
              </div>
            );
          })}
        </div>
      </div>
      <div ref={dock} className={styles.dock}>
        {live ? null : (
          <button type="button" className={styles.jump} onClick={jump}>
            <FormattedMessage id="conversation.jumpToLatest" />
          </button>
        )}
        {props.dock}
      </div>
    </div>
  );
}
