import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { OrganizationExecutiveEffectReceipt } from "@lervo/application-contract";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteOrganizationExecutiveEffectReplay } from "../src/organization-executive-replay.js";

const roots: string[] = [];
const hash = (character: string) => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("organization executive effect replay", () => {
  it("persists a completed exact effect and rejects coordinate reuse with another payload", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-executive-replay-"));
    roots.push(root);
    const path = resolve(root, "replay.sqlite");
    const coordinate = {
      effectId: "ceoe_createchannel01",
      requestId: "ceor_createchannel01",
      effectHash: hash("a"),
      attemptedAt: "2026-09-09T00:00:00.000Z",
    };
    const receipt: OrganizationExecutiveEffectReceipt = {
      schemaVersion: 1,
      effectId: coordinate.effectId,
      requestId: coordinate.requestId,
      decisionHash: hash("b"),
      effectHash: coordinate.effectHash,
      adapterId: "discord_administration_v1",
      externalEffectId: "1547000000000000000",
      resultHash: hash("c"),
      completedAt: "2026-09-09T00:00:01.000Z",
    };

    const first = await SQLiteOrganizationExecutiveEffectReplay.open(path);
    await expect(first.begin(coordinate)).resolves.toEqual({ status: "reserved" });
    await first.complete(receipt);
    first.close();

    const reopened = await SQLiteOrganizationExecutiveEffectReplay.open(path);
    await expect(reopened.begin(coordinate)).resolves.toEqual({ status: "completed", receipt });
    await expect(reopened.begin({ ...coordinate, effectHash: hash("d") })).resolves.toEqual({
      status: "conflict",
    });
    reopened.close();
  });

  it("preserves an uncertain outcome as fail-closed across restart", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-executive-unknown-"));
    roots.push(root);
    const path = resolve(root, "replay.sqlite");
    const coordinate = {
      effectId: "ceoe_createchannel02",
      requestId: "ceor_createchannel02",
      effectHash: hash("e"),
      attemptedAt: "2026-09-09T00:00:00.000Z",
    };
    const first = await SQLiteOrganizationExecutiveEffectReplay.open(path);
    await first.begin(coordinate);
    await first.markUnknown(coordinate);
    first.close();

    const reopened = await SQLiteOrganizationExecutiveEffectReplay.open(path);
    await expect(reopened.begin(coordinate)).resolves.toEqual({ status: "unknown" });
    reopened.close();
  });
});
