import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./PopoverMenu.module.css";

export interface PopoverMenuItem {
  readonly text: string;
  /** One quiet line under the item's text, such as what a role does. */
  readonly detail?: string;
  /** The item's shortcut or a short note as text, such as `⌘O`, shown at its end. */
  readonly shortcut?: string;
  readonly run: () => void;
}

/** The gap between the control and its menu (`space.4`). */
const MENU_GAP = 4;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A menu the interface draws, directly below the control that opened it and as wide as it (ADE
 * motion, "Overlays: command palette, menus, popovers"). Its opening and closing motion stay
 * visible, where the system menu freezes the window for a moment after it closes. Up and Down
 * move between items, Return chooses, and Escape or a click outside closes it. As in a macOS menu,
 * no item is chosen until the pointer or a key chooses one, except that a menu a key opened starts
 * on its first item.
 */
export function PopoverMenu(props: {
  /** The bounds of the control that opened the menu, in window coordinates. */
  anchor: { readonly left: number; readonly bottom: number; readonly width: number };
  label: string;
  items: readonly PopoverMenuItem[];
  /** Whether a key opened the menu, so its first item starts chosen. */
  openedByKey?: boolean;
  /** A wider menu, for items that carry a line of detail. */
  wide?: boolean;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(props.openedByKey === true ? 0 : -1);
  const menu = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const close = (then?: () => void) => {
    then?.();
    if (reducedMotion()) onClose();
    else setClosing(true);
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    menu.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) closeRef.current();
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, []);

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={props.label}
      tabIndex={-1}
      className={styles.menu}
      data-closing={closing ? "" : undefined}
      data-wide={props.wide === true ? "" : undefined}
      style={{
        top: props.anchor.bottom + MENU_GAP,
        left: props.anchor.left,
        width: props.anchor.width,
      }}
      onAnimationEnd={() => {
        if (closing) onClose();
      }}
      onPointerLeave={() => setActive(-1)}
      onKeyDown={(event) => {
        const count = props.items.length;
        if (event.key === "ArrowDown") setActive((index) => (index + 1) % count);
        else if (event.key === "ArrowUp") setActive((index) => (index < 0 ? count : index) - 1);
        else if (event.key === "Enter") {
          const item = props.items[active];
          if (item !== undefined) close(item.run);
        } else if (event.key === "Escape") close();
        else return;
        event.preventDefault();
      }}
    >
      {props.items.map((item, index) => (
        <button
          key={item.text}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={styles.item}
          data-active={index === active ? "" : undefined}
          onPointerEnter={() => setActive(index)}
          onClick={() => close(item.run)}
        >
          {item.detail === undefined ? (
            <span>{item.text}</span>
          ) : (
            <span className={styles.texts}>
              <span>{item.text}</span>
              <span className={styles.detail}>{item.detail}</span>
            </span>
          )}
          {item.shortcut === undefined ? null : (
            <span className={styles.shortcut}>{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
