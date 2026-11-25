import { CloseIcon } from "./icons";
import styles from "./ImageTray.module.css";

/** An image waiting in an input card: what to draw, its accessible name, and whether it is ready. */
export interface TrayImage {
  readonly key: string;
  readonly src: string;
  readonly alt: string;
  /** Still being prepared: drawn faint with the waiting sweep, and not yet removable. */
  readonly preparing?: boolean;
}

/**
 * Images waiting in an input card to go with what is typed, as small thumbnails above its field
 * (Lervo ADE sessions, "Images in a message"). A thumbnail opens the image at full size; its remove
 * button shows on hover and keyboard focus.
 */
export function ImageTray(props: {
  images: readonly TrayImage[];
  removeLabel: (index: number) => string;
  onRemove: (key: string) => void;
  onOpen: (index: number) => void;
}) {
  return (
    <ul className={styles.tray}>
      {props.images.map((image, index) => (
        <li
          key={image.key}
          className={styles.tile}
          data-preparing={image.preparing ? "" : undefined}
        >
          <button
            type="button"
            className={styles.open}
            disabled={image.preparing}
            onClick={() => props.onOpen(index)}
          >
            {/* The image's text names the button. */}
            <img className={styles.image} src={image.src} alt={image.alt} />
          </button>
          {/* motion: Coming and going */}
          {image.preparing ? null : (
            <button
              type="button"
              className={styles.remove}
              aria-label={props.removeLabel(index)}
              onClick={() => props.onRemove(image.key)}
            >
              <CloseIcon size="sm" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
