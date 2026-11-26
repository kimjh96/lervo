import styles from "./AttachmentTray.module.css";
import { FileChip } from "./FileChip";
import { CloseIcon } from "./icons";

/** An image waiting in an input card: what to draw, its accessible name, and whether it is ready. */
export interface TrayImage {
  readonly key: string;
  readonly src: string;
  readonly alt: string;
  readonly removeLabel: string;
  /** Still being prepared: drawn faint with the waiting sweep, and not yet removable. */
  readonly preparing?: boolean;
}

/** A file waiting in an input card, attached by path, as its chip shows it. */
export interface TrayFile {
  readonly key: string;
  readonly name: string;
  readonly detail: string;
  readonly badge: string;
  readonly folder: boolean;
  readonly label: string;
  readonly removeLabel: string;
}

/**
 * What waits in an input card to go with what is typed, on one row above its field: images as
 * small thumbnails, then files as chips of the same height (Lervo ADE sessions, "Images in a
 * message" and "Files in a message"). A thumbnail opens the image at full size, a chip shows the
 * file in Finder; each remove button shows on hover and keyboard focus.
 */
export function AttachmentTray(props: {
  images: readonly TrayImage[];
  files: readonly TrayFile[];
  onRemove: (key: string) => void;
  onOpenImage: (index: number) => void;
  onOpenFile: (key: string) => void;
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
            onClick={() => props.onOpenImage(index)}
          >
            {/* The image's text names the button. */}
            <img className={styles.image} src={image.src} alt={image.alt} />
          </button>
          {/* motion: Coming and going */}
          {image.preparing ? null : (
            <button
              type="button"
              className={styles.remove}
              aria-label={image.removeLabel}
              onClick={() => props.onRemove(image.key)}
            >
              <CloseIcon size="sm" />
            </button>
          )}
        </li>
      ))}
      {props.files.map((file) => (
        <li key={file.key} className={styles.file}>
          <FileChip
            size="tray"
            name={file.name}
            detail={file.detail}
            badge={file.badge}
            folder={file.folder}
            label={file.label}
            onOpen={() => props.onOpenFile(file.key)}
            removeLabel={file.removeLabel}
            onRemove={() => props.onRemove(file.key)}
          />
        </li>
      ))}
    </ul>
  );
}
