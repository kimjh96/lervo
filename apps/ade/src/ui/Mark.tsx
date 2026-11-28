import styles from "./Mark.module.css";
import { Presence } from "./Presence";

/** How many mark colors the tokens define (`color.mark.1` to `color.mark.6`). */
export const MARK_COLORS = 6;

/** The mark color for an ID: the same on every host, from a small hash of the ID. */
export function markColor(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % MARK_COLORS) + 1;
}

/** A name's first letter, as a mark shows it: its first grapheme, upper-cased when it has case. */
export function markLetter(name: string): string {
  const [first] = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.trim());
  return (first?.segment ?? "?").toLocaleUpperCase();
}

/**
 * A project's or an agent's mark (ADR-0637, "Projects and agents carry one identity mark"): its
 * image when it has one, otherwise its first letter on a color chosen by its ID. It is decorative
 * beside the name it stands for, which carries the accessible name.
 */
export function Mark(props: {
  id: string;
  name: string;
  /** The image as a URL the webview draws, such as a data URL; null shows the first letter. */
  src: string | null;
  size: "sm" | "md" | "lg";
  shape?: "square" | "round";
}) {
  return (
    <span
      className={styles.mark}
      data-size={props.size}
      data-shape={props.shape ?? "square"}
      aria-hidden="true"
    >
      {/* A letter that becomes an image, or the reverse, crossfades with its color; a mark that
          mounts with either shows it at once. */}
      <Presence
        as="span"
        className={styles.face}
        contentKey={props.src ?? "letter"}
        fill
        enterOnMount={false}
      >
        {props.src === null ? (
          <span className={styles.letter} data-color={markColor(props.id)}>
            {markLetter(props.name)}
          </span>
        ) : (
          <img className={styles.image} src={props.src} alt={props.name} draggable={false} />
        )}
      </Presence>
    </span>
  );
}
