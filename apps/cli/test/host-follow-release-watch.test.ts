import { afterEach, describe, expect, it } from "vitest";

import {
  FOLLOW_PASS_RELEASE_CHECK_MS,
  followHeldTag,
  followReleaseWatch,
} from "../src/host-follow-release-watch.js";
import { writeFollowControl } from "../src/host-follow-state.js";
import { cleanDirectories, followHarness, release } from "./host-follow-fixture.js";

afterEach(cleanDirectories);

describe("followReleaseWatch", () => {
  it("lists releases at most once a minute and answers the tag the poll would install", async () => {
    const harness = await followHarness();
    let clock = Date.parse("2026-11-17T00:00:00.000Z");
    const watch = followReleaseWatch({
      layout: harness.layout,
      source: harness.source,
      activeVersion: "9.9.9",
      failedTags: [],
      now: () => new Date(clock),
      heldTag: null,
      listed: {
        releases: [{ tag: "v9.9.9", draft: false, prerelease: false }],
        at: new Date(clock),
      },
    });
    harness.releases.push(release("9.9.10"));
    const listings = harness.source.listings;
    // The cycle's own listing is reused within the bound.
    expect(await watch.installable()).toBeNull();
    clock += FOLLOW_PASS_RELEASE_CHECK_MS - 1;
    expect(await watch.installable()).toBeNull();
    expect(harness.source.listings).toBe(listings);
    clock += 1;
    expect(await watch.installable()).toBe("v9.9.10");
    expect(await watch.installable()).toBe("v9.9.10");
    expect(harness.source.listings).toBe(listings + 1);
  });

  it("honours a pause, a pin, and a failed tag, and treats a failed listing as no release", async () => {
    const harness = await followHarness();
    harness.releases.push(release("9.9.10"), release("9.9.11"));
    let clock = Date.parse("2026-11-17T00:00:00.000Z");
    const watch = (failedTags: string[]) =>
      followReleaseWatch({
        layout: harness.layout,
        source: harness.source,
        activeVersion: "9.9.9",
        failedTags,
        now: () => new Date((clock += FOLLOW_PASS_RELEASE_CHECK_MS)),
        listed: null,
        heldTag: null,
      });
    expect(await watch(["v9.9.11"]).installable()).toBeNull();
    await writeFollowControl(harness.layout, {
      schemaVersion: 1,
      paused: false,
      pinnedTag: "v9.9.10",
      changedAt: "t",
    });
    expect(await watch([]).installable()).toBe("v9.9.10");
    await writeFollowControl(harness.layout, {
      schemaVersion: 1,
      paused: true,
      pinnedTag: null,
      changedAt: "t",
    });
    expect(await watch([]).installable()).toBeNull();
    await writeFollowControl(harness.layout, {
      schemaVersion: 1,
      paused: false,
      pinnedTag: null,
      changedAt: "t",
    });
    harness.source.failListing = true;
    expect(await watch([]).installable()).toBeNull();
  });

  it("leaves a tag whose install is held to the poll", async () => {
    const harness = await followHarness();
    harness.releases.push(release("9.9.10"));
    const watch = (heldTag: string | null) =>
      followReleaseWatch({
        layout: harness.layout,
        source: harness.source,
        activeVersion: "9.9.9",
        failedTags: [],
        now: () => new Date("2026-11-17T00:00:00.000Z"),
        listed: null,
        heldTag,
      });
    expect(await watch("v9.9.10").installable()).toBeNull();
    expect(await watch(null).installable()).toBe("v9.9.10");
    const outcome = (value: string) => ({ outcome: value, tag: "v9.9.10" });
    for (const held of ["waiting", "host_blocked", "busy", "install_retry", "install_abandoned"])
      expect(followHeldTag(outcome(held))).toBe("v9.9.10");
    for (const settled of ["current", "upgraded", "repositories_retried", "release_failed"])
      expect(followHeldTag(outcome(settled))).toBeNull();
    expect(followHeldTag(null)).toBeNull();
  });
});
