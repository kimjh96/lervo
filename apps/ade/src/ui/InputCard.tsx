import { type KeyboardEvent, type ReactNode, type Ref, useLayoutEffect, useRef } from "react";

import styles from "./InputCard.module.css";
import { Presence } from "./Presence";

/**
 * A card that holds a text field and its actions, such as the instruction card of the start
 * screen or the reply card of a conversation. `surface` says what it sits on: `input` on the
 * window, `floating` over content that shows through it blurred. `layout` puts the actions
 * under the field (`stacked`) or beside it (`inline`). The card shows the field's focus.
 */
export function InputCard(props: {
  surface: "input" | "floating";
  layout: "stacked" | "inline";
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      className={styles.card}
      data-surface={props.surface}
      data-layout={props.layout}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
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
  ref?: Ref<HTMLTextAreaElement> | undefined;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
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
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
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
      <textarea
        ref={attach}
        className={styles.field}
        data-size={props.size}
        aria-label={props.label}
        placeholder={props.placeholder}
        disabled={props.disabled}
        rows={props.rows}
        value={value}
        onChange={(event) => props.onChange(event.target.value)}
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
