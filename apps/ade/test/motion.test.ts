import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error The motion check is a plain build script without type declarations.
import { checkMotion, motionViolations } from "../scripts/check-motion.mjs";

describe("the motion check", () => {
  it("finds no violation in the interface's stylesheets", async () => {
    expect(await checkMotion(join(import.meta.dirname, ".."))).toEqual([]);
  });

  it("rejects literal durations and easings, layout transitions, and layout keyframes", () => {
    const css = `
      .a { transition: width 200ms ease; }
      .b { animation: grow var(--motion-duration-enter) linear; }
      @keyframes grow { from { height: 0; } to { opacity: 1; } }
      .ok { transition: background-color var(--motion-duration-change) var(--motion-easing-standard); }
    `;
    expect(motionViolations(css, "x.css")).toEqual([
      "x.css: transition uses a duration that is not a motion token",
      "x.css: transition uses an easing that is not a motion token",
      "x.css: transition moves width",
      "x.css: animation uses an easing that is not a motion token",
      "x.css: @keyframes grow animates height",
    ]);
  });
});
