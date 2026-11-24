import { type ReactNode, useEffect, useState } from "react";

import { motion } from "../design/generated/motion";
import styles from "./Presence.module.css";

const shownOf = (children: ReactNode) =>
  children !== null && children !== undefined && children !== false;

interface Layer {
  readonly key: string;
  readonly node: ReactNode;
  readonly leaving: boolean;
  /** Arrived while other content was leaving, so it waits for that content to go first. */
  readonly after: boolean;
}

/**
 * The motion of anything a view shows only sometimes, or changes in one place (ADE motion,
 * "Coming and going" and "Changing in place"). Content fades in over `motion.duration.change`.
 * When `children` becomes empty, the last content fades out over `motion.duration.leave` before it
 * unmounts. When `contentKey` changes, the old content fades out and then the new fades in, in
 * the same space, so a button can become its wait and then its result without anything jumping
 * and without two texts overlapping. Leaving content takes no clicks and is hidden from assistive technology. The ADE's
 * lint rule requires this, or a named motion pattern, for every element that comes and goes.
 */
export function Presence(props: {
  children: ReactNode;
  /** Names what is shown; a new name crossfades from the old content to the new. */
  contentKey?: string;
  /** `span` inside a line of controls, such as a header; `div` elsewhere. */
  as?: "div" | "span";
  /** False when the content brings its own arrival, such as the needs-you dot. */
  enter?: boolean;
  className?: string | undefined;
}) {
  const present = shownOf(props.children);
  const key = props.contentKey ?? "content";
  const [layers, setLayers] = useState<readonly Layer[]>(
    present ? [{ key, node: props.children, leaving: false, after: false }] : [],
  );
  // The layers follow the children during render, so the leaving content is still at hand.
  const current = layers.find((layer) => !layer.leaving);
  if (present && current?.key !== key) {
    const others = layers
      .filter((layer) => layer.key !== key)
      .map((layer) => ({ ...layer, leaving: true }));
    setLayers([...others, { key, node: props.children, leaving: false, after: others.length > 0 }]);
  } else if (present && current !== undefined && current.node !== props.children)
    setLayers(
      layers.map((layer) => (layer === current ? { ...layer, node: props.children } : layer)),
    );
  else if (!present && current !== undefined)
    setLayers(layers.map((layer) => ({ ...layer, leaving: true })));
  const leaving = layers
    .filter((layer) => layer.leaving)
    .map((layer) => layer.key)
    .join(" ");
  useEffect(() => {
    if (leaving === "") return;
    const timer = setTimeout(
      () => setLayers((all) => all.filter((layer) => !layer.leaving)),
      motion.leaveMs,
    );
    return () => clearTimeout(timer);
  }, [leaving]);
  if (layers.length === 0) return null;
  const Element = props.as ?? "div";
  return (
    <Element
      className={[styles.presence, props.className].filter(Boolean).join(" ")}
      data-inline={Element === "span" ? "" : undefined}
    >
      {layers.map((layer) => (
        <Element
          key={layer.key}
          className={styles.layer}
          data-leaving={layer.leaving ? "" : undefined}
          data-enter={props.enter === false ? undefined : ""}
          data-after={layer.after ? "" : undefined}
          aria-hidden={layer.leaving ? true : undefined}
          inert={layer.leaving}
        >
          {layer.node}
        </Element>
      ))}
    </Element>
  );
}
