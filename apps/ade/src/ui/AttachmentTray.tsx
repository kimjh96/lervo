import { type ReactNode, useState } from "react";

import styles from "./AttachmentTray.module.css";
import { useDepartingInPlace } from "./departing";
import { FileChip } from "./FileChip";
import { CloseIcon } from "./icons";
import { useItemSpace } from "./space";

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
  const images = useDepartingInPlace(props.images, itemKey);
  const files = useDepartingInPlace(props.files, itemKey);
  // What the tray held when it first showed arrived with it; whatever comes later opens its own
  // space.
  const [initial] = useState(
    () => new Set([...props.images, ...props.files].map((item) => item.key)),
  );
  return (
    <ul className={styles.tray}>
      {images.map(({ item: image, leaving }) => (
        <TrayItem
          key={image.key}
          className={styles.tile}
          arrived={!initial.has(image.key)}
          leaving={leaving}
          preparing={image.preparing === true}
        >
          <button
            type="button"
            className={styles.open}
            disabled={image.preparing}
            onClick={() => props.onOpenImage(props.images.indexOf(image))}
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
        </TrayItem>
      ))}
      {files.map(({ item: file, leaving }) => (
        <TrayItem
          key={file.key}
          className={styles.file}
          arrived={!initial.has(file.key)}
          leaving={leaving}
        >
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
        </TrayItem>
      ))}
    </ul>
  );
}

const itemKey = (item: { key: string }) => item.key;

/**
 * One thumbnail or chip in the tray: one added while the person watches opens its width as it
 * fades in, and one removed fades out and closes its width where it was, so its neighbours slide
 * instead of jumping (ADE motion, "Coming and going" and "Space").
 */
function TrayItem(props: {
  className: string | undefined;
  arrived: boolean;
  leaving: boolean;
  preparing?: boolean;
  children: ReactNode;
}) {
  const space = useItemSpace<HTMLLIElement>(props.arrived, props.leaving, "inline");
  return (
    <li
      ref={space}
      className={props.className}
      data-preparing={props.preparing === true ? "" : undefined}
      data-leaving={props.leaving ? "" : undefined}
      aria-hidden={props.leaving ? true : undefined}
      inert={props.leaving}
    >
      {props.children}
    </li>
  );
}
