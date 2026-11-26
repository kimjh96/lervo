import { type RefObject, useLayoutEffect, useRef } from "react";

import { motion } from "../design/generated/motion";

/** Which size of an element its space is: its height, or its width inside a line of controls. */
export type SpaceAxis = "block" | "inline";

/** What a change of a place's layers does to its space (ADE motion, "Space"). */
export type SpaceStep = "open" | "close" | "resize" | "settle" | "none";

interface Layers {
  readonly current: string | null;
  readonly leaving: readonly string[];
}

/** A place's layers written as `key+` for the shown one and `key-` for each leaving one. */
export function layersOf(structure: string): Layers {
  const entries = structure.split(" ").filter((entry) => entry.length > 0);
  return {
    current: entries.find((entry) => entry.endsWith("+"))?.slice(0, -1) ?? null,
    leaving: entries.filter((entry) => entry.endsWith("-")).map((entry) => entry.slice(0, -1)),
  };
}

/**
 * How the space moves when a place's layers change: it opens when content arrives in an empty
 * place, closes when the last content leaves, resizes when new content replaces the old, and
 * settles once the old content is gone.
 */
export function spaceStep(previous: string, next: string): SpaceStep {
  const before = layersOf(previous);
  const after = layersOf(next);
  if (after.current === null)
    return before.current !== null && after.leaving.length > 0 ? "close" : "none";
  if (before.current === null && before.leaving.length === 0) return "open";
  if (before.current !== after.current) return "resize";
  return before.leaving.length > 0 && after.leaving.length === 0 ? "settle" : "none";
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** An element's size on an axis, as laid out now, including a running animation's value. */
export function sizeOf(element: Element, axis: SpaceAxis): number {
  const box = element.getBoundingClientRect();
  return axis === "block" ? box.height : box.width;
}

type Margins = readonly [number, number];

/** An element's margins on an axis, start then end, as laid out now. */
export function marginsOf(element: Element, axis: SpaceAxis): Margins {
  const style = getComputedStyle(element);
  return axis === "block"
    ? [Number.parseFloat(style.marginBlockStart) || 0, Number.parseFloat(style.marginBlockEnd) || 0]
    : [
        Number.parseFloat(style.marginInlineStart) || 0,
        Number.parseFloat(style.marginInlineEnd) || 0,
      ];
}

const NO_MARGINS: Margins = [0, 0];

/**
 * Moves an element's space from one size to another on the fade easing, so the content around it
 * slides instead of jumping (ADE motion, "Space"). What overflows the moving space is clipped only
 * while it moves. `hold` keeps the last size until the caller cancels the animation, as a place
 * whose old content still lays out at its full size needs; otherwise the element returns to its
 * natural size when the motion ends. An element that opens or closes moves its margins with its
 * size, so they never jump when it mounts or unmounts. Nothing moves under reduced motion, without
 * the Web Animations API, or when the sizes match.
 */
export function moveSpace(
  element: HTMLElement,
  move: {
    axis: SpaceAxis;
    from: number;
    to: number;
    duration: number;
    hold: boolean;
    margins?: { from: Margins; to: Margins };
  },
): Animation | null {
  if (reducedMotion() || typeof element.animate !== "function") return null;
  if (Math.abs(move.from - move.to) < 0.5) return null;
  const block = move.axis === "block";
  const frame = (size: number, margins: Margins | undefined) => ({
    [block ? "height" : "width"]: `${size}px`,
    ...(margins === undefined
      ? {}
      : {
          [block ? "marginBlockStart" : "marginInlineStart"]: `${margins[0]}px`,
          [block ? "marginBlockEnd" : "marginInlineEnd"]: `${margins[1]}px`,
        }),
  });
  element.style.overflow = "clip";
  const animation = element.animate(
    [frame(move.from, move.margins?.from), frame(move.to, move.margins?.to)],
    { duration: move.duration, easing: motion.fadeEasing, fill: "forwards" },
  );
  animation.addEventListener("cancel", () => element.style.removeProperty("overflow"));
  animation.addEventListener("finish", () => {
    if (!move.hold) animation.cancel();
  });
  return animation;
}

/**
 * The space of one list item that arrives while the person watches or leaves the list: it opens
 * from nothing when the item mounts as an arrival and closes to nothing when it starts leaving,
 * with the item's own fade (ADE motion, "Space").
 */
export function useItemSpace<T extends HTMLElement>(
  arrived: boolean,
  leaving: boolean,
): RefObject<T | null> {
  const element = useRef<T>(null);
  const animation = useRef<Animation | null>(null);
  // Only an item that mounts as an arrival opens; one that was already listed stays still.
  const arrivedOnMount = useRef(arrived);
  useLayoutEffect(() => {
    const item = element.current;
    if (item === null || !arrivedOnMount.current) return;
    animation.current = moveSpace(item, {
      axis: "block",
      from: 0,
      to: sizeOf(item, "block"),
      duration: motion.enterMs,
      hold: false,
      margins: { from: NO_MARGINS, to: marginsOf(item, "block") },
    });
  }, []);
  useLayoutEffect(() => {
    const item = element.current;
    if (item === null || !leaving) return;
    const from = sizeOf(item, "block");
    const margins = marginsOf(item, "block");
    animation.current?.cancel();
    animation.current = moveSpace(item, {
      axis: "block",
      from,
      to: 0,
      duration: motion.leaveMs,
      hold: true,
      margins: { from: margins, to: NO_MARGINS },
    });
  }, [leaving]);
  return element;
}
