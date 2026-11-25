import { useEffect, useRef } from "react";

import { CloseIcon } from "./icons";
import styles from "./ImageViewer.module.css";

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
 * An image at full size over a dimmed window, with only a close button and, for several images,
 * their count and arrows (Lervo ADE sessions, "Images in a message"). Escape or a click outside
 * the image closes it, and the arrow keys move between images. It takes the focus when it opens
 * and gives it back when it closes.
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
  useEffect(() => {
    const opener = document.activeElement;
    close.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (event.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [images.length, index, onClose, onIndex]);
  if (image === undefined) return null;
  const several = images.length > 1;
  return (
    <div className={styles.viewer} role="dialog" aria-modal="true" aria-label={props.labels.dialog}>
      {/* A click on the dimmed window outside the image closes it, as Escape does. */}
      <button
        type="button"
        className={styles.veil}
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
      />
      <img className={styles.image} src={image.src} alt={image.alt} />
      <button
        ref={close}
        type="button"
        className={styles.close}
        aria-label={props.labels.close}
        onClick={onClose}
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
    </div>
  );
}
