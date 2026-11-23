import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "../../../platform/environment";
import { type Arrival, nextShown, paceDeadline, recordArrival } from "../model/pacing";

/**
 * The part of a streaming `text` to show now (ADE motion, "A reply streams"). Text present when
 * the item mounts shows at once, so history and a reopened conversation never animate; text that
 * arrives later flows in over a few frames. Each growth's arrival is kept, so text shows within
 * `PACE_MS` of its own arrival even while more keeps coming. Nothing runs once the text is caught
 * up, and reduced motion shows everything at once.
 */
export function usePacedText(text: string): string {
  const [shown, setShown] = useState(text.length);
  const arrivals = useRef<Arrival[]>([]);
  const behind = shown < text.length && !prefersReducedMotion();

  useEffect(() => {
    arrivals.current = recordArrival(arrivals.current, shown, text.length, performance.now());
    // `shown` only prunes the arrivals here; a frame's own update must not record one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    if (!behind) return;
    let frame = 0;
    let previous = performance.now();
    const step = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      setShown((value) => {
        const deadline = paceDeadline(arrivals.current, value) ?? now;
        return nextShown(text, value, elapsed, deadline - now + elapsed);
      });
      // Catching up ends `behind`, and with it these frames.
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [behind, text]);

  return behind ? text.slice(0, shown) : text;
}
