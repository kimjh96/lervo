import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "./icons";
import styles from "./ImageViewer.module.css";

/** Longer than the closing motion: a window that runs no animation closes after it. */
const CLOSE_FALLBACK_MS = 400;

export interface ViewedImage {
  readonly src: string;
  readonly alt: string;
}

function ChevronIcon(props: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={props.direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/**
 * An image at full size over the blurred window, with only a close button and, for several
 * images, their count and arrows (Lervo ADE sessions, "Images in a message"). Escape or a click
 * outside the image closes it, and the arrow keys move between images. It takes the focus when it
 * opens and gives it back when it closes. It renders into the document's body and plays its own
 * closing, the blur easing out, and calls `onClose` once that ends.
 */
export function ImageViewer(props: {
  images: readonly ViewedImage[];
  index: number;
  labels: { dialog: string; close: string; previous: string; next: string; count: string };
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const { images, index, onIndex, onClose } = props;
  const image = images[index];
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    // Without motion, or once already closing, it closes at once.
    if (closing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) onClose();
    else setClosing(true);
  };
  // A window that runs no animation, such as a hidden one, still closes.
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, CLOSE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  useEffect(() => {
    const opener = document.activeElement;
    close.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
      else if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (event.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (image === undefined) return null;
  const several = images.length > 1;
  return createPortal(
    <div
      className={styles.viewer}
      role="dialog"
      aria-modal="true"
      aria-label={props.labels.dialog}
      data-closing={closing ? "" : undefined}
    >
      <div className={styles.blur} />
      {/* A click on the blurred window outside the image closes it, as Escape does. */}
      <button
        type="button"
        className={styles.veil}
        tabIndex={-1}
        aria-hidden="true"
        onClick={requestClose}
        onAnimationEnd={(event) => {
          if (closing && event.target === event.currentTarget) onClose();
        }}
      />
      <img className={styles.image} src={image.src} alt={image.alt} />
      <button
        ref={close}
        type="button"
        className={styles.close}
        aria-label={props.labels.close}
        onClick={requestClose}
      >
        <CloseIcon size="md" />
      </button>
      {/* motion: Coming and going */}
      {several ? (
        <>
          <button
            type="button"
            className={styles.arrow}
            data-side="previous"
            aria-label={props.labels.previous}
            disabled={index === 0}
            onClick={() => onIndex(index - 1)}
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            className={styles.arrow}
            data-side="next"
            aria-label={props.labels.next}
            disabled={index === images.length - 1}
            onClick={() => onIndex(index + 1)}
          >
            <ChevronIcon direction="right" />
          </button>
          <p className={styles.count}>{props.labels.count}</p>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
