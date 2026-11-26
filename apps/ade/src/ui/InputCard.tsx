import { type KeyboardEvent, type ReactNode, type Ref, useLayoutEffect, useRef } from "react";

import { PaperClipIcon } from "./icons";
import styles from "./InputCard.module.css";

/** Ends a decorated field's copy, so a trailing new line keeps its height as in the field. */
const LAST_LINE = "\n";
import { Presence } from "./Presence";

/**
 * A card that holds a text field and its actions, such as the instruction card of the start
 * screen or the reply card of a conversation. `surface` says what it sits on: `input` on the
 * window, `floating` over content that shows through it blurred. `layout` puts the actions
 * under the field (`stacked`) or beside it (`inline`). The card shows the field's focus. While
 * files are dragged over the window, `dropHint` says that the card takes them: its border turns to
 * the accent and the hint takes the place of what waits.
 */
export function InputCard(props: {
  surface: "input" | "floating";
  layout: "stacked" | "inline";
  onSubmit: () => void;
  /** What waits to go with the text, such as pasted images, on its own line above the field. */
  attachments?: ReactNode;
  dropHint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <form
      className={styles.card}
      data-surface={props.surface}
      data-layout={props.layout}
      data-dropping={props.dropHint === undefined ? undefined : ""}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      {/* The tray and the drop hint open and close their space with their fade, and crossfade
          in place when one replaces the other (ADE motion, "Coming and going" and "Space"). */}
      <Presence contentKey={props.dropHint === undefined ? "attachments" : "drop"}>
        {props.dropHint === undefined ? (
          props.attachments === undefined ? null : (
            <div className={styles.attachments}>{props.attachments}</div>
          )
        ) : (
          <div className={styles.attachments}>
            <span className={styles.dropHint}>
              <PaperClipIcon size="lg" />
              {props.dropHint}
            </span>
          </div>
        )}
      </Presence>
      {props.children}
    </form>
  );
}

/**
 * The text field of an input card. Enter submits and Shift+Enter starts a new line, and an input
 * method's composition is respected. With `maxLines`, the field grows with its text up to that
 * many lines and then scrolls. The placeholder is drawn over the empty field, so a change of its
 * words crossfades in place; it shows and hides with the text at once, as native fields do.
 */
export function InputField(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** `input` for an instruction, `body` for a reply. */
  size: "input" | "body";
  rows: number;
  maxLines?: number | undefined;
  disabled?: boolean | undefined;
  /** Escape outside an input method's composition, such as stopping the agent's turn. */
  onEscape?: (() => void) | undefined;
  /**
   * A key the caller handles before the field, such as one that moves through suggestions; it
   * answers whether it handled the key.
   */
  onKey?: ((event: KeyboardEvent<HTMLTextAreaElement>) => boolean) | undefined;
  /**
   * Draws the field's text behind it with parts set apart, such as mentions as pills. The field's
   * own text turns transparent above it, so only what this draws shows, and the caret and the
   * selection stay the field's.
   */
  decorate?: ((value: string) => ReactNode) | undefined;
  /** The suggestions the field offers as the person types, for assistive technology. */
  suggestions?: { id: string; expanded: boolean; activeId: string | undefined } | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const backdrop = useRef<HTMLSpanElement | null>(null);
  const { maxLines, value } = props;
  useLayoutEffect(() => {
    const element = own.current;
    if (element === null || maxLines === undefined) return;
    element.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    const limit = Number.isNaN(lineHeight) ? element.scrollHeight : lineHeight * maxLines;
    element.style.height = `${Math.min(element.scrollHeight, limit)}px`;
  }, [maxLines, value]);
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (props.onKey?.(event) === true) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && props.onEscape !== undefined) {
      event.preventDefault();
      props.onEscape();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    props.onSubmit();
  };
  const attach = (element: HTMLTextAreaElement | null) => {
    own.current = element;
    const { ref } = props;
    if (typeof ref === "function") ref(element);
    else if (ref !== null && ref !== undefined) ref.current = element;
  };
  return (
    <span className={styles.box}>
      {props.decorate === undefined ? null : (
        <span ref={backdrop} className={styles.backdrop} data-size={props.size} aria-hidden="true">
          {props.decorate(value)}
          {LAST_LINE}
        </span>
      )}
      <textarea
        ref={attach}
        className={styles.field}
        data-size={props.size}
        data-decorated={props.decorate === undefined ? undefined : ""}
        aria-label={props.label}
        aria-autocomplete={props.suggestions === undefined ? undefined : "list"}
        aria-controls={props.suggestions?.expanded === true ? props.suggestions.id : undefined}
        aria-activedescendant={props.suggestions?.activeId}
        placeholder={props.placeholder}
        disabled={props.disabled}
        rows={props.rows}
        value={value}
        onChange={(event) => props.onChange(event.target.value)}
        onScroll={(event) => {
          if (backdrop.current !== null) backdrop.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={keyDown}
      />
      <span
        className={styles.placeholder}
        data-size={props.size}
        aria-hidden="true"
        hidden={value !== ""}
      >
        <Presence as="span" contentKey={props.placeholder}>
          {props.placeholder}
        </Presence>
      </span>
    </span>
  );
}
