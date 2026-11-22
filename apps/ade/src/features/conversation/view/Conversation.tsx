import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";

import { useConversationStore } from "../model/store";
import styles from "./Conversation.module.css";
import { ConversationItemView } from "./renderers";

const NEAR_EDGE_PX = 48;

/**
 * The native conversation, virtualized: only items near the viewport mount. It follows new items
 * while the user is at the bottom and offers "Jump to latest" otherwise (ADE motion, "Following
 * the stream"). Scrolling near the top loads the previous page.
 */
export function Conversation(props: { onLoadEarlier: () => void }) {
  const window = useConversationStore((store) => store.window);
  const arrived = useConversationStore((store) => store.arrived);
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  // The interface does not use the React Compiler, so the virtualizer's unmemoizable functions
  // need no compiler support.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: window.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 64,
    getItemKey: (index) => window.items[index]?.itemId ?? index,
    overscan: 8,
  });
  const last = window.items.at(-1);
  const lastLength = last !== undefined && "text" in last ? last.text.length : 0;

  useLayoutEffect(() => {
    if (following && window.items.length > 0)
      virtualizer.scrollToIndex(window.items.length - 1, { align: "end" });
  }, [following, window.items.length, lastLength, virtualizer]);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const scrolled = () => {
      const bottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      setFollowing(bottom < NEAR_EDGE_PX);
      if (element.scrollTop < NEAR_EDGE_PX) props.onLoadEarlier();
    };
    element.addEventListener("scroll", scrolled, { passive: true });
    return () => element.removeEventListener("scroll", scrolled);
  }, [props]);

  return (
    <div className={styles.frame}>
      <div ref={scroller} className={styles.scroller} role="log" aria-live="polite">
        <div className={styles.list} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = window.items[row.index];
            if (item === undefined) return null;
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
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
      {following ? null : (
        <button type="button" className={styles.jump} onClick={() => setFollowing(true)}>
          <FormattedMessage id="conversation.jumpToLatest" />
        </button>
      )}
    </div>
  );
}
