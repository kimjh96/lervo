import { expect, it } from "vitest";

import { nextUtcDayAt } from "../src/practice-schedule.js";
import {
  RESIDENT_WAKE_OFFSET_MAXIMUM_MILLISECONDS as MAXIMUM,
  residentWakeOffset,
} from "../src/resident-wake-offset.js";

it("gives each project a stable offset of at most 15 minutes (ADR-0597)", () => {
  const offsets = Array.from({ length: 64 }, (_, index) =>
    residentWakeOffset(`prj_${index.toString(16).padStart(16, "0")}`),
  );
  for (const offset of offsets) {
    expect(Number.isSafeInteger(offset)).toBe(true);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(MAXIMUM);
  }
  // Deterministic across calls and spread across projects.
  expect(residentWakeOffset("prj_0000000000000001")).toBe(offsets[1]);
  expect(new Set(offsets).size).toBeGreaterThan(48);
});

it("moves the day-boundary wake by the offset and keeps it in the future", () => {
  const midnight = Date.parse("2026-11-20T00:00:00.000Z");
  const offset = 7 * 60_000;
  expect(nextUtcDayAt(midnight - 1)).toBe(midnight);
  expect(nextUtcDayAt(midnight - 1, offset)).toBe(midnight + offset);
  // Between midnight and the offset the previous day's wake is still ahead.
  expect(nextUtcDayAt(midnight + 60_000, offset)).toBe(midnight + offset);
  expect(nextUtcDayAt(midnight + offset, offset)).toBe(midnight + 86_400_000 + offset);
});
