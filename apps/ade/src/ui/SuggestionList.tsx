import type { ReactNode } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";

import styles from "./PopoverMenu.module.css";
import { sizes } from "../design/generated/sizes";

export interface Suggestion {
  readonly key: string;
  readonly text: string;
  readonly leading?: ReactNode;
  readonly detail?: string;
}

export interface SuggestionGroup {
  readonly label: string;
  readonly items: readonly Suggestion[];
}

/** The element ID of a list's suggestion, for the field's active descendant. */
export function suggestionId(listId: string, index: number): string {
  return [listId, String(index)].join("-");
}

/** The gap between the caret's line and the list (`space.4`). */
const LIST_GAP = sizes.space["4"];

/**
 * Suggestions for what the person is typing, such as the agents an `@` can mention (Lervo ADE
 * rooms, "The ADE"). It hangs above the caret on the menu's glass and keeps the focus in the
 * field: the field's keys move the choice and choose, so typing narrows the list as it goes. It
 * rises as a menu does and sinks when it closes.
 */
export function SuggestionList(props: {
  id: string;
  label: string;
  open: boolean;
  /** The caret's line, in window coordinates; the list's bottom sits just above it. */
  anchor: { readonly left: number; readonly top: number };
  groups: readonly SuggestionGroup[];
  /** The chosen suggestion's index across the groups. */
  active: number;
  onChoose: (suggestion: Suggestion) => void;
  onActive: (index: number) => void;
}) {
  // A list that closes stays until its sinking ends; under reduced motion it leaves at once.
  const [shown, setShown] = useState(props.open);
  if (props.open && !shown) setShown(true);
  if (!props.open && shown && matchMedia("(prefers-reduced-motion: reduce)").matches)
    setShown(false);
  // A closing list sinks where it was, with what it last showed: the field drops its query as it
  // closes, which would move the list to the window's corner and refill it with every agent.
  const [last, setLast] = useState({ anchor: props.anchor, groups: props.groups });
  if (props.open && (last.anchor !== props.anchor || last.groups !== props.groups))
    setLast({ anchor: props.anchor, groups: props.groups });
  if (!shown) return null;
  const anchor = props.open ? props.anchor : last.anchor;
  const groups = props.open ? props.groups : last.groups;
  // Each suggestion's index across the groups, which the field's keys and the active choice use.
  const offsets = groups.map((_, group) =>
    groups.slice(0, group).reduce((count, earlier) => count + earlier.items.length, 0),
  );
  return createPortal(
    <div
      id={props.id}
      role="listbox"
      aria-label={props.label}
      className={styles.menu}
      data-above=""
      data-wide=""
      data-closing={props.open ? undefined : ""}
      style={{
        left: anchor.left,
        bottom: window.innerHeight - anchor.top + LIST_GAP,
      }}
      onAnimationEnd={() => {
        if (!props.open) setShown(false);
      }}
      // The field keeps the focus: a press on the list never takes it.
      onPointerDown={(event) => event.preventDefault()}
    >
      {groups.map((group, groupIndex) => (
        <div key={group.label} role="group" aria-label={group.label} className={styles.group}>
          <span className={styles.groupLabel} aria-hidden="true">
            {group.label}
          </span>
          {group.items.map((item, itemIndex) => {
            const at = (offsets[groupIndex] ?? 0) + itemIndex;
            return (
              <div
                key={item.key}
                id={suggestionId(props.id, at)}
                role="option"
                tabIndex={-1}
                aria-selected={at === props.active}
                className={styles.item}
                data-active={at === props.active ? "" : undefined}
                onPointerEnter={() => props.onActive(at)}
                // The field keeps the focus and its keys choose; a pointer chooses on release.
                onPointerUp={() => props.onChoose(item)}
              >
                {/* motion: Fixed parts */}
                {item.leading === undefined ? null : (
                  <span className={styles.leading}>{item.leading}</span>
                )}
                <span className={styles.texts}>
                  <span>{item.text}</span>
                  {/* motion: Fixed parts */}
                  {item.detail === undefined ? null : (
                    <span className={styles.detail}>{item.detail}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}
