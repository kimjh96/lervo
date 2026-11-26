import { useEffect, useRef, useState } from "react";

import { useFiles } from "../../../ports";

/** The cards that take dropped files, newest last: only the newest one takes a drag. */
const takers: symbol[] = [];

/**
 * Files dragged over the window, for the input card that takes them (Lervo ADE sessions, "Files in
 * a message"). While files are over the window, `dragging` is true so the card can show where
 * they go; a drop anywhere hands their paths to `onDrop`. When several cards are mounted, the one
 * mounted last takes the drag.
 */
export function useFileDrop(onDrop: (paths: readonly string[]) => void): boolean {
  const files = useFiles();
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onDrop);
  useEffect(() => {
    latest.current = onDrop;
  });
  useEffect(() => {
    const me = Symbol("file-drop");
    takers.push(me);
    const stop = files.watchDrags((drag) => {
      if (takers.at(-1) !== me) return;
      setDragging(drag.kind === "enter");
      if (drag.kind === "drop") latest.current(drag.paths);
    });
    return () => {
      stop();
      takers.splice(takers.indexOf(me), 1);
      setDragging(false);
    };
  }, [files]);
  return dragging;
}
