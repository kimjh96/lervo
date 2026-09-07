import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type {
  LiveTriggerAdmissionPlanV1,
  LiveTriggerCompletionV1,
} from "@lervo/live-trigger-contract";
import { SQLiteLiveTriggerReservationStore } from "@lervo/live-trigger-sqlite";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function plan(suffix: string, maximumAcceptedTriggers = 2): LiveTriggerAdmissionPlanV1 {
  const hash = (value: string) => `sha256:${value.repeat(64)}`;
  return {
    schemaVersion: 1,
    planId: `ltp_${suffix.repeat(24)}`,
    status: "ready",
    projectId: "prj_0123456789abcdef",
    workstreamId: "wks_0123456789abcdef01234567",
    adapterId: "adapter.webhook",
    adapterVersion: "1.0.0",
    descriptorHash: hash("a"),
    sourceId: "source.primary",
    sourceEventKeyHash: hash(suffix),
    requestContentHash: hash("b"),
    authenticationReceiptHash: hash("c"),
    authorizationId: "lwa_0123456789abcdef01234567",
    authorizationHash: hash("d"),
    routineId: "routine.test",
    templateVersion: "1.0.0",
    templateHash: hash("e"),
    invocationFingerprintHash: hash(suffix),
    maximumAcceptedTriggers,
    admittedAt: "2026-09-07T00:00:00.000Z",
    blockedReasons: [],
    request: {} as LiveTriggerAdmissionPlanV1["request"],
  };
}

describe("SQLite live-trigger reservations", () => {
  it("atomically enforces replay, conflicts, budget, recovery, and retention", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-live-trigger-store-"));
    roots.push(root);
    const store = await SQLiteLiveTriggerReservationStore.open({
      path: resolve(root, "trigger.sqlite"),
    });
    const first = await store.reserve(plan("1"));
    expect(first).toMatchObject({ status: "reserved", recovery: false });
    expect(await store.reserve(plan("1"))).toEqual({ status: "in_progress" });
    const conflicting = plan("1");
    conflicting.invocationFingerprintHash = `sha256:${"f".repeat(64)}`;
    expect(await store.reserve(conflicting)).toEqual({ status: "idempotency_conflict" });
    if (first.status !== "reserved") throw new Error("Expected reservation.");
    await store.requireRecovery({
      reservationId: first.reservationId,
      failedAt: "2026-09-07T00:01:00.000Z",
    });
    expect(await store.reserve(plan("1"))).toMatchObject({ status: "recoverable", recovery: true });
    const completion: LiveTriggerCompletionV1 = {
      schemaVersion: 1,
      planId: plan("1").planId,
      invocationId: "rin_0123456789abcdef01234567",
      disposition: "materialized",
      assignmentIds: ["asn_0123456789abcdef01234567"],
      completedAt: "2026-09-07T00:02:00.000Z",
    };
    await store.complete({ reservationId: first.reservationId, completion });
    expect(await store.reserve(plan("1"))).toEqual({ status: "current", completion });
    expect(await store.reserve(plan("2", 1))).toEqual({ status: "budget_exhausted" });
    expect(await store.pruneCompleted({ before: "2026-09-08T00:00:00.000Z", limit: 10 })).toBe(1);
    expect(await store.reserve(plan("2", 1))).toEqual({ status: "budget_exhausted" });
    const unfinished = plan("3");
    unfinished.authorizationHash = `sha256:${"f".repeat(64)}`;
    const unfinishedReservation = await store.reserve(unfinished);
    expect(unfinishedReservation).toMatchObject({ status: "reserved" });
    expect(
      await store.recoverUnfinished({
        before: "2026-09-07T00:01:00.000Z",
        limit: 10,
      }),
    ).toBe(1);
    expect(await store.reserve(unfinished)).toMatchObject({ status: "recoverable" });
    await store.close();
  });
});
