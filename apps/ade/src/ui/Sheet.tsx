import {
  type AnimationEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import styles from "./Sheet.module.css";

/** The sheet's field, input, and button classes, for the forms it holds. */
export { styles as sheetStyles };

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * How a sheet closes: Cancel, Escape wherever the focus is in it, a click outside, and a dismissal
 * from outside, such as a change that succeeded, all play its closing before it unmounts; under
 * reduced motion it leaves at once.
 */
function useClosing(dismissed: boolean, onClose: () => void, onGone: () => void) {
  const [closing, setClosing] = useState(false);
  const leaving = closing || dismissed;
  useEffect(() => {
    if (dismissed && reducedMotion()) onGone();
  }, [dismissed, onGone]);
  const close = useCallback(() => {
    if (!reducedMotion()) {
      setClosing(true);
      return;
    }
    onClose();
    onGone();
  }, [onClose, onGone]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [close]);
  const ended = (event: AnimationEvent<HTMLElement>) => {
    if (!leaving || event.target !== event.currentTarget) return;
    onClose();
    onGone();
  };
  return { leaving, close, ended };
}

/**
 * A small glass window over Lervo (ADE motion, "Overlays: command palette, menus, popovers"): a
 * heading, labeled fields, and its actions, as the "New Project" window shows them. It opens and
 * closes as ADE motion's overlays do. `children` receives `close`, which Cancel calls.
 */
export function Sheet(props: {
  /** The ID of the heading that names the sheet. */
  labelledBy: string;
  /** Closed from outside, such as by a change that succeeded. */
  dismissed: boolean;
  /** Forgets the sheet, as Cancel, Escape, or a click outside asks. */
  onClose: () => void;
  /** The closing has ended, so the sheet can unmount. */
  onGone: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const { leaving, close, ended } = useClosing(props.dismissed, props.onClose, props.onGone);
  const window_ = useRef<HTMLDivElement>(null);
  return createPortal(
    <div
      className={styles.backdrop}
      data-closing={leaving ? "" : undefined}
      onPointerDown={(event) => {
        if (!(event.target instanceof Node) || !window_.current?.contains(event.target)) close();
      }}
    >
      <div className={styles.blur} />
      <div className={styles.veil} />
      <div
        ref={window_}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.labelledBy}
        className={styles.sheet}
        onAnimationEnd={ended}
      >
        <div className={styles.content}>{props.children(close)}</div>
      </div>
    </div>,
    document.body,
  );
}

/** The sheet's heading: what it does, and one line on what follows. */
export function SheetHeading(props: { id: string; title: ReactNode; subtitle: ReactNode }) {
  return (
    <div className={styles.heading}>
      <h2 id={props.id} className={styles.title}>
        {props.title}
      </h2>
      <p className={styles.subtitle}>{props.subtitle}</p>
    </div>
  );
}

/** One labeled field of a sheet. */
export function SheetField(props: { label: ReactNode; children: ReactNode }) {
  return (
    <label className={styles.label}>
      {props.label}
      {props.children}
    </label>
  );
}
