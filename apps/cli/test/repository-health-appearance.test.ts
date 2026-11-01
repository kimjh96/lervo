import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readHealthAppearance,
  recordHealthStopAppearance,
} from "../src/repository-health-appearance.js";

const statePath = (root: string) => join(root, ".lervo/state/repository-health-appearance.json");

describe("repository health stop appearance", () => {
  it("starts recording on the first owner turn and keeps each stop's first appearance", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-appearance-"));
    expect(await readHealthAppearance(root)).toBeNull();

    await recordHealthStopAppearance({ root, stop: null, at: "2026-11-01T00:00:00.000Z" });
    expect(await readHealthAppearance(root)).toEqual({
      schemaVersion: 1,
      recordingSince: "2026-11-01T00:00:00.000Z",
      stops: [],
    });
    expect((await stat(statePath(root))).mode & 0o777).toBe(0o600);

    // A stop that began before recording stays unknown and is not recorded.
    await recordHealthStopAppearance({
      root,
      stop: { since: "2026-10-31T00:00:00.000Z", reason: "earlier" },
      at: "2026-11-01T00:05:00.000Z",
    });
    expect((await readHealthAppearance(root))!.stops).toEqual([]);

    const stop = { since: "2026-11-01T01:00:00.000Z", reason: "knowledge_source_kind_unsupported" };
    await recordHealthStopAppearance({ root, stop, at: "2026-11-01T01:10:00.000Z" });
    const before = await readFile(statePath(root), "utf8");
    await recordHealthStopAppearance({ root, stop, at: "2026-11-01T02:00:00.000Z" });
    expect(await readFile(statePath(root), "utf8")).toBe(before);
    expect((await readHealthAppearance(root))!.stops).toEqual([
      { ...stop, firstPreparedAt: "2026-11-01T01:10:00.000Z" },
    ]);
  });

  it("bounds recorded stops to the 64 newest", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-appearance-"));
    await recordHealthStopAppearance({ root, stop: null, at: "2026-01-01T00:00:00.000Z" });
    for (let index = 0; index < 70; index += 1) {
      const since = new Date(Date.parse("2026-02-01T00:00:00.000Z") + index * 60_000).toISOString();
      await recordHealthStopAppearance({ root, stop: { since, reason: null }, at: since });
    }
    const stops = (await readHealthAppearance(root))!.stops;
    expect(stops).toHaveLength(64);
    expect(stops[0]!.since).toBe("2026-02-01T01:09:00.000Z");
  });
});
