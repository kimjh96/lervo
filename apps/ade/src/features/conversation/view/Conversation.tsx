import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";

import { useConversationStore } from "../model/store";
import styles from "./Conversation.module.css";
import { ConversationItemView } from "./renderers";

const NEAR_EDGE_PX = 48;
const SCROLL_UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/** Where the reader is: the first visible item and how far its top sits above the viewport. */
interface Anchor {
  readonly itemId: string;
  readonly offset: number;
}

/**
 * The native conversation, virtualized: only items near the viewport mount, and their heights
 * are measured once per item. It follows the live end until the user scrolls up, and then offers
 * "Jump to latest" (ADE motion, "Following the stream"). Pages load at either edge of the window,
 * and the item the user is reading stays in place when items are added or dropped above it.
 */
export function Conversation(props: {
  onLoadEarlier: () => void;
  onLoadLater: () => void;
  onJumpToLatest: () => void;
}) {
  const window = useConversationStore((store) => store.window);
  const arrived = useConversationStore((store) => store.arrived);
  const scroller = useRef<HTMLDivElement>(null);
  const items = useRef(window.items);
  items.current = window.items;
  const anchor = useRef<Anchor | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const [following, setFollowing] = useState(true);
  const live = following && !window.hasLater;
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

  // While following, the newest text stays in view as items arrive and heights are measured.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (live && element !== null) element.scrollTop = element.scrollHeight;
  }, [live, window.items.length, lastLength, totalSize]);

  // When items are added or dropped above the reader, the item they read stays where it was.
  useLayoutEffect(() => {
    const element = scroller.current;
    const reading = anchor.current;
    if (live || element === null || reading === null) return;
    const index = items.current.findIndex((item) => item.itemId === reading.itemId);
    const start = virtualizer.measurementsCache[index]?.start;
    if (start !== undefined) element.scrollTop = start - reading.offset;
  }, [firstItemId, live, virtualizer]);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    let dragging = false;
    const remember = () => {
      const top = element.scrollTop;
      const row = virtualizer.getVirtualItems().find((candidate) => candidate.end > top);
      const item = row === undefined ? undefined : items.current[row.index];
      anchor.current =
        row === undefined || item === undefined
          ? null
          : { itemId: item.itemId, offset: top - row.start };
    };
    // Only the user leaves the live end: a wheel or key up, or dragging the scroll bar.
    const leave = () => setFollowing(false);
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) leave();
    };
    const key = (event: KeyboardEvent) => {
      if (SCROLL_UP_KEYS.has(event.key)) leave();
    };
    const press = () => (dragging = true);
    const release = () => (dragging = false);
    const scrolled = () => {
      remember();
      const bottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (bottom < NEAR_EDGE_PX) {
        handlers.current.onLoadLater();
        setFollowing(true);
      } else if (dragging) leave();
      if (element.scrollTop < NEAR_EDGE_PX) handlers.current.onLoadEarlier();
    };
    element.addEventListener("scroll", scrolled, { passive: true });
    element.addEventListener("wheel", wheel, { passive: true });
    element.addEventListener("keydown", key);
    element.addEventListener("pointerdown", press);
    globalThis.addEventListener("pointerup", release);
    return () => {
      element.removeEventListener("scroll", scrolled);
      element.removeEventListener("wheel", wheel);
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
    <div className={styles.frame}>
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
      {live ? null : (
        <button type="button" className={styles.jump} onClick={jump}>
          <FormattedMessage id="conversation.jumpToLatest" />
        </button>
      )}
    </div>
  );
}
