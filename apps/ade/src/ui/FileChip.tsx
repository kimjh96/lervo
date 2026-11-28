import styles from "./FileChip.module.css";
import { CloseIcon, FolderIcon } from "./icons";

/**
 * A file attached to a message by path: a type badge, its name, and a line under it, such as the
 * folder it is in (file mockup, "A"). `tray` is the size beside image thumbnails in an input card,
 * `message` the size in a sent message's bubble. Opening it shows the file in Finder; a missing
 * file is faint and does not open. With `onRemove`, a remove button shows on hover and focus.
 */
export function FileChip(props: {
  name: string;
  /** The line under the name, such as `Downloads · 84 KB`. */
  detail: string;
  /** The extension the badge shows, such as `PDF`; ignored for a folder. */
  badge: string;
  folder?: boolean | undefined;
  missing?: boolean | undefined;
  size: "tray" | "message";
  /** The accessible name of the chip, which opens the file. */
  label: string;
  onOpen: () => void;
  removeLabel?: string | undefined;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <span
      className={styles.chip}
      data-size={props.size}
      data-missing={props.missing ? "" : undefined}
    >
      <button
        type="button"
        className={styles.open}
        aria-label={props.label}
        disabled={props.missing}
        onClick={props.onOpen}
      >
        <span
          className={styles.badge}
          data-folder={props.folder ? "" : undefined}
          aria-hidden="true"
        >
          {props.folder ? <FolderIcon size="lg" /> : props.badge}
        </span>
        <span className={styles.text} aria-hidden="true">
          <span className={styles.name}>{props.name}</span>
          <span className={styles.detail}>{props.detail}</span>
        </span>
      </button>
      {/* motion: Fixed parts */}
      {props.onRemove === undefined ? null : (
        <button
          type="button"
          className={styles.remove}
          aria-label={props.removeLabel}
          onClick={props.onRemove}
        >
          <CloseIcon size="sm" />
        </button>
      )}
    </span>
  );
}
