import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { motion } from "../design/generated/motion";
import styles from "./Presence.module.css";
import { marginsOf, moveSpace, sizeOf, type SpaceAxis, spaceStep } from "./space";

const shownOf = (children: ReactNode) =>
  children !== null && children !== undefined && children !== false;

interface Layer {
  readonly key: string;
  /** Present when the place first mounted. */
  readonly mounted?: boolean;
  readonly node: ReactNode;
  readonly leaving: boolean;
  /** Arrived while other content was leaving, so it starts halfway through that leaving. */
  readonly after: boolean;
}

/**
 * The motion of anything a view shows only sometimes, or changes in one place (ADE motion,
 * "Coming and going" and "Changing in place"). Content fades in over `motion.duration.enter`.
 * When `children` becomes empty, the last content fades out over `motion.duration.leave` before it
 * unmounts. When `contentKey` changes, the old content fades out and the new fades in halfway
 * through, in the same space, so a button can become its wait and then its result without
 * anything jumping and without two texts reading over each other. The place's space opens,
 * closes, and resizes with its content (ADE motion, "Space"). Leaving content takes no clicks
 * and is hidden from assistive technology. The ADE's lint rule requires this, or a named motion
 * pattern, for every element that comes and goes. Whole views use `ViewPresence`.
 */
export function Presence(props: {
  children: ReactNode;
  /** Names what is shown; a new name crossfades from the old content to the new. */
  contentKey?: string;
  /** `span` inside a line of controls, such as a header; `div` elsewhere. */
  as?: "div" | "span";
  /**
   * Which edge content keeps while the space changes size. `end` suits a place pinned to the
   * bottom, such as the sidebar footer, so the new content never moves when the old leaves.
   */
  align?: "start" | "end";
  /**
   * Which side content keeps while the space changes width: `end` suits a header's controls, and
   * `center` a wait in the middle of a view.
   */
  justify?: "start" | "end" | "center" | undefined;
  className?: string | undefined;
  /**
   * Whether content present when the place first mounts fades in. A place inside loaded content,
   * such as a tool line's open details in history, passes false, since loaded content does not
   * move (principle 8).
   */
  enterOnMount?: boolean;
  /**
   * How content arrives: it fades in, or, for glass such as a floating button, it rises from 0.98
   * and keeps its glass from the first frame, since WebKit draws no backdrop blur on an element
   * whose opacity animates (ADE craft rules, 14). Content leaves by fading either way.
   */
  arrival?: "fade" | "rise";
}) {
  const present = shownOf(props.children);
  const key = props.contentKey ?? "content";
  const [layers, setLayers] = useState<readonly Layer[]>(
    present ? [{ key, node: props.children, leaving: false, after: false, mounted: true }] : [],
  );
  const [mountEnter] = useState(props.enterOnMount !== false);
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
  const Element = props.as ?? "div";
  const place = usePlaceSpace(
    layers.map((layer) => `${layer.key}${layer.leaving ? "-" : "+"}`).join(" "),
    Element === "span" ? "inline" : "block",
  );
  if (layers.length === 0) return null;
  return (
    <Element
      ref={place}
      className={[styles.presence, props.className].filter(Boolean).join(" ")}
      data-inline={Element === "span" ? "" : undefined}
      data-align={props.align}
      data-justify={props.justify}
    >
      {layers.map((layer) => (
        <Element
          key={layer.key}
          className={styles.layer}
          data-leaving={layer.leaving ? "" : undefined}
          data-enter={layer.mounted && !mountEnter ? undefined : ""}
          data-arrival={props.arrival === "rise" ? "rise" : undefined}
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

/**
 * Moves a place's space with its layers (ADE motion, "Space"): it opens when content arrives in an
 * empty place, closes when the last content leaves, and resizes from the old content to the new,
 * each with the content's fade. A place that mounts with its content opens at once. Returns the
 * callback ref for the place's element, which is a `div` or a `span`.
 */
function usePlaceSpace(structure: string, axis: SpaceAxis) {
  const element = useRef<HTMLElement>(null);
  const previous = useRef<string | null>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = structure;
    const place = element.current;
    if (before === null || place === null) return;
    const step = spaceStep(before, structure);
    if (step === "none") return;
    const running = animation.current?.playState === "running";
    if (step === "settle") {
      // The old content is gone, so the place's natural size is the new content's.
      if (!running) animation.current?.cancel();
      else animation.current?.addEventListener("finish", () => animation.current?.cancel());
      return;
    }
    const layers = [...place.children] as HTMLElement[];
    const shown = layers.find((layer) => !layer.hasAttribute("data-leaving"));
    const old = layers.filter((layer) => layer.hasAttribute("data-leaving"));
    const from = running
      ? sizeOf(place, axis)
      : step === "open"
        ? 0
        : Math.max(0, ...old.map((layer) => sizeOf(layer, axis)));
    const margins = marginsOf(place, axis);
    animation.current?.cancel();
    animation.current = moveSpace(place, {
      axis,
      from,
      to: shown === undefined ? 0 : sizeOf(shown, axis),
      // Opening and closing move the place's own margins too, so they never jump.
      ...(step === "open"
        ? { margins: { from: [0, 0] as const, to: margins } }
        : shown === undefined
          ? { margins: { from: margins, to: [0, 0] as const } }
          : {}),
      duration: step === "open" ? motion.enterMs : motion.leaveMs,
      // While old content still lays out, the place would take the larger size, so it holds the
      // new size until the old content is gone; a closing place holds until it unmounts.
      hold: shown === undefined || old.length > 0,
    });
  }, [structure, axis]);
  return useCallback((node: HTMLElement | null) => {
    element.current = node;
  }, []);
}
