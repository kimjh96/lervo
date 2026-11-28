import { MAXIMUM_OWNER_TITLE_CHARACTERS } from "@lervo/session-host-contract";
import { useEffect, useRef } from "react";

/**
 * A conversation's title edited in place (ADE craft rules, 12), with the title's own type: Return
 * or leaving the field keeps the new title, and Escape keeps the old one. An unchanged or empty
 * title changes nothing, and `onDone` receives null for it.
 */
export function TitleField(props: {
  title: string;
  label: string;
  className: string | undefined;
  onDone: (title: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    const title = value?.replace(/\s+/gu, " ").trim() ?? "";
    props.onDone(title.length > 0 && title !== props.title ? title : null);
  };
  return (
    <input
      ref={input}
      className={props.className}
      aria-label={props.label}
      defaultValue={props.title}
      maxLength={MAXIMUM_OWNER_TITLE_CHARACTERS}
      spellCheck={false}
      onBlur={(event) => finish(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") finish(event.currentTarget.value);
        else if (event.key === "Escape") finish(null);
      }}
    />
  );
}
