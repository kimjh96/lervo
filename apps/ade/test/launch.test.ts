import { describe, expect, it } from "vitest";

import { launchLimitMs, launchReady } from "../src/app/launch";

describe("the launch view", () => {
  const waiting = { connection: "connecting", listsSettled: false, budgetPassed: false } as const;

  it("stays while the first lists load within the cold-start budget", () => {
    expect(launchReady(waiting)).toBe(false);
    expect(launchReady({ ...waiting, connection: "connected" })).toBe(false);
    expect(launchReady({ ...waiting, connection: "reconnecting" })).toBe(false);
  });

  it("leaves when the lists settle or the session host is unavailable", () => {
    expect(launchReady({ ...waiting, connection: "connected", listsSettled: true })).toBe(true);
    expect(launchReady({ ...waiting, connection: "unavailable" })).toBe(true);
  });

  it("never holds the first screen past the cold-start budget", () => {
    expect(launchLimitMs).toBe(500);
    expect(launchReady({ ...waiting, budgetPassed: true })).toBe(true);
  });
});
