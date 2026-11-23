import { useEffect, useState } from "react";

import { nextShown, PACE_MS } from "../model/pacing";

const reducedMotion =
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/**
 * The part of a streaming `text` to show now (ADE motion, "A reply streams"). Text present when
 * the item mounts shows at once, so history and a reopened conversation never animate; text that
 * arrives later flows in over a few frames. Nothing runs once the text is caught up, and reduced
 * motion shows everything at once.
 */
export function usePacedText(text: string): string {
  const [shown, setShown] = useState(text.length);
  const behind = shown < text.length && reducedMotion?.matches !== true;

  useEffect(() => {
    if (!behind) return;
    let frame = 0;
    let previous = performance.now();
    // Text that grew restarts these frames, so all of it shows within PACE_MS of its arrival.
    const deadline = previous + PACE_MS;
    const step = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      setShown((value) => nextShown(text, value, elapsed, deadline - now + elapsed));
      // Catching up ends `behind`, and with it these frames.
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [behind, text]);

  return behind ? text.slice(0, shown) : text;
}
