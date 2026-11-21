import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listenEventStoreChanges } from "@lervo/event-store-sqlite";
import { planStatePrune } from "@lervo/project";
import { afterEach, expect, it } from "vitest";

import { planStateReset } from "../src/state-reset-plan.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it.skipIf(process.platform === "win32")(
  "plans state status, reset and prune beside a live event channel without touching it (ADR-0602)",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-state-channel-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, ".lervo/data"), { recursive: true });
    await mkdir(join(root, ".lervo/state/knowledge"), { recursive: true });
    await writeFile(join(root, ".lervo/data/events.sqlite"), "");
    await writeFile(join(root, ".lervo/state/knowledge/derived.json"), "{}\n");
    const listener = listenEventStoreChanges(
      join(root, ".lervo/data/events.sqlite"),
      () => undefined,
      () => undefined,
    );
    cleanups.push(() => listener.close());
    expect(listener.available()).toBe(true);
    const fifos = async () => readdir(join(root, ".lervo/run/events.sqlite"));
    const before = await fifos();
    expect(before.some((name) => name.endsWith(".fifo"))).toBe(true);

    // Status and reset inventory read only derived state; the FIFOs are not in it.
    for (const bindContent of [false, true]) {
      const plan = await planStateReset(root, bindContent);
      expect(JSON.stringify(plan)).not.toContain(".fifo");
    }
    const prune = await planStatePrune({
      repositoryRoot: root,
      evidence: {
        completedNormalizationCandidateIds: new Set(),
        completedCanonicalizationCandidateIds: new Set(),
        completedDeliberationIds: new Set(),
        activeDeliberationIds: new Set(),
      } as never,
    });
    // The subscriber's own record is lifecycle-owned, so prune never offers to remove it.
    expect(JSON.stringify(prune)).not.toContain("event-channel");
    expect(await fifos()).toEqual(before);
  },
);
