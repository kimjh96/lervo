import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SQLiteRemoteCommandReplayStore } from "../src/index.js";

const roots: string[] = [];
const target = {
  projectId: "prj_remote_replay",
  projectIdentityHash: `sha256:${"f".repeat(64)}`,
} as const;

async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-remote-command-replay-"));
  roots.push(root);
  return resolve(root, "state/replay.sqlite");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function coordinate(byte = "a", id = "01") {
  return {
    commandHash: `sha256:${byte.repeat(64)}`,
    idempotencyKey: `idk_remote_replay_${id}`,
    nonce: Buffer.alloc(32, Number(id)).toString("base64url"),
  };
}

describe("durable remote command replay store", () => {
  it("recovers a terminal receipt after process restart without storing command content", async () => {
    const path = await databasePath();
    const first = await SQLiteRemoteCommandReplayStore.open({ path, target });
    const selected = coordinate();
    const reservation = await first.reserve(selected);
    expect(reservation.status).toBe("reserved");
    if (reservation.status !== "reserved") throw new Error("fixture reservation failed");
    const receipt = {
      schemaVersion: 1 as const,
      commandId: `rcm_${"b".repeat(64)}`,
      commandHash: selected.commandHash,
      idempotencyKey: selected.idempotencyKey,
      processedAt: "2026-08-19T00:01:00.000Z",
      outcome: "executed" as const,
      runId: "run_remote_replay",
    };
    await first.complete({ reservationId: reservation.reservationId, receipt });
    first.close();

    const reopened = await SQLiteRemoteCommandReplayStore.open({ path, target });
    await expect(reopened.inspect(selected)).resolves.toEqual({
      status: "duplicate",
      receipt,
    });
    reopened.close();
  });

  it("keeps incomplete reservations fail-closed and distinguishes both replay coordinates", async () => {
    const path = await databasePath();
    const first = await SQLiteRemoteCommandReplayStore.open({ path, target });
    const selected = coordinate();
    await first.reserve(selected);
    first.close();

    const reopened = await SQLiteRemoteCommandReplayStore.open({ path, target });
    await expect(reopened.inspect(selected)).resolves.toEqual({ status: "in_progress" });
    await expect(
      reopened.inspect({ ...selected, commandHash: `sha256:${"c".repeat(64)}` }),
    ).resolves.toEqual({ status: "idempotency_conflict" });
    await expect(
      reopened.inspect({ ...coordinate("d", "02"), nonce: selected.nonce }),
    ).resolves.toEqual({ status: "nonce_replay" });
    reopened.close();
  });

  it("fails closed at bounded capacity instead of evicting replay protection", async () => {
    const store = await SQLiteRemoteCommandReplayStore.open({
      path: await databasePath(),
      target,
      maxRecords: 1,
    });
    await store.reserve(coordinate());
    await expect(store.reserve(coordinate("c", "02"))).rejects.toMatchObject({
      code: "capacity_exceeded",
    });
    await expect(store.inspect(coordinate())).resolves.toEqual({ status: "in_progress" });
    store.close();
  });

  it("refuses to reopen project-bound replay state for another project identity", async () => {
    const path = await databasePath();
    const store = await SQLiteRemoteCommandReplayStore.open({ path, target });
    store.close();

    await expect(
      SQLiteRemoteCommandReplayStore.open({
        path,
        target: { ...target, projectIdentityHash: `sha256:${"e".repeat(64)}` },
      }),
    ).rejects.toMatchObject({ code: "integrity_failed" });
  });
});
