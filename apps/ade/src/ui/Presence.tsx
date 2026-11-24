import { type ReactNode, useEffect, useState } from "react";

import { motion } from "../design/generated/motion";
import styles from "./Presence.module.css";

const shownOf = (children: ReactNode) =>
  children !== null && children !== undefined && children !== false;

/**
 * The motion of anything a view shows only sometimes (ADE motion, "Coming and going"): content
 * fades in over `motion.duration.change` when it appears, and when `children` becomes empty the
 * last content fades out over `motion.duration.exit` before it unmounts, so nothing pops in or
 * vanishes in a frame. New content replaces leaving content at once. While leaving, the content
 * takes no clicks and is hidden from assistive technology. The ADE's lint rule requires it, or a
 * named motion pattern, for every element that comes and goes.
 */
export function Presence(props: {
  children: ReactNode;
  /** `span` inside a line of controls, such as a header; `div` elsewhere. */
  as?: "div" | "span";
  /** False when the content brings its own arrival, such as the needs-you dot. */
  enter?: boolean;
  className?: string | undefined;
}) {
  const present = shownOf(props.children);
  const [kept, setKept] = useState<ReactNode>(present ? props.children : null);
  const [gone, setGone] = useState(!present);
  // Remembering the last content during render keeps it for the leaving frames.
  if (present && kept !== props.children) setKept(props.children);
  if (present && gone) setGone(false);
  useEffect(() => {
    if (present) return;
    const timer = setTimeout(() => setGone(true), motion.exitMs);
    return () => clearTimeout(timer);
  }, [present]);
  if (!present && (gone || !shownOf(kept))) return null;
  const Element = props.as ?? "div";
  return (
    <Element
      className={[styles.presence, props.className].filter(Boolean).join(" ")}
      data-leaving={present ? undefined : ""}
      data-enter={props.enter === false ? undefined : ""}
      aria-hidden={present ? undefined : true}
      inert={!present}
    >
      {present ? props.children : kept}
    </Element>
  );
}
