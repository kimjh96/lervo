// Where a text field's caret is, for a list that hangs from it.

/** The field's computed properties that decide where its text wraps and how tall its lines are. */
const MIRRORED = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "wordSpacing",
  "textIndent",
  "tabSize",
] as const;

/**
 * The top-left corner of the caret's line in window coordinates. A hidden copy of the field, with
 * the same wrapping, holds the text before the caret and a marker where the caret stands.
 */
export function caretPoint(field: HTMLTextAreaElement): { left: number; top: number } {
  const style = getComputedStyle(field);
  const mirror = document.createElement("div");
  for (const name of MIRRORED) mirror.style[name] = style[name];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = field.value.slice(0, field.selectionEnd);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.append(marker);
  document.body.append(mirror);
  const box = field.getBoundingClientRect();
  const point = {
    left: box.left + marker.offsetLeft - field.scrollLeft,
    top: box.top + marker.offsetTop - field.scrollTop,
  };
  mirror.remove();
  return point;
}
