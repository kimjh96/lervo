import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { writeFollowControl } from "../src/host-follow-state.js";
import { hostUpgradeLayout } from "../src/host-upgrade-layout.js";
import { releaseTrainHold } from "../src/knowledge-convergence-ownership.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

it("holds knowledge publication merges while the host's release follower is paused", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-release-hold-"));
  homes.push(home);
  const layout = hostUpgradeLayout({ homeDirectory: home, platform: "darwin" });
  expect(await releaseTrainHold(layout)).toBeNull();
  const changedAt = new Date().toISOString();
  await writeFollowControl(layout, {
    schemaVersion: 1,
    paused: true,
    pinnedTag: null,
    changedAt,
  });
  expect(await releaseTrainHold(layout)).toBe("release_train");
  await writeFollowControl(layout, {
    schemaVersion: 1,
    paused: false,
    pinnedTag: null,
    changedAt,
  });
  expect(await releaseTrainHold(layout)).toBeNull();
});
