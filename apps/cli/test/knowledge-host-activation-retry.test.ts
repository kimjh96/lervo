import { expect, it } from "vitest";

import { activationRetryAt } from "../src/knowledge-host-activation-retry.js";

it("waits for the watched signal of a local blocker and backs a remote one off (ADR-0602)", () => {
  const now = 1_000_000;
  // The runtime pointer and the writer coordinate are watched: no timer at all.
  expect(activationRetryAt("terminal_hook_reader_stale", 1, now)).toBe(Number.POSITIVE_INFINITY);
  expect(activationRetryAt("event_writer_plan_stale", 3, now)).toBe(Number.POSITIVE_INFINITY);
  // Only a Hub or Node of an earlier release clears these: 30, 60, 120 minutes, to 8 hours.
  const minutes = (attempts: number) =>
    (activationRetryAt("reader_inventory_hub_unavailable", attempts, now) - now) / 60_000;
  expect([1, 2, 3, 9].map(minutes)).toEqual([30, 60, 120, 480]);
  expect(minutes(1)).toBe((activationRetryAt(null, 1, now) - now) / 60_000);
});
