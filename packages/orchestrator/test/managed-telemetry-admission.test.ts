import { afterEach, describe, expect, it } from "vitest";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { ManagedTelemetryRecorder } from "../src/telemetry.js";
import { runRequestedSpecs } from "../src/provider-run-events.js";
import {
  cleanupManagedFixtures,
  createManagedFixture,
  policyVersion,
  projectId,
  role,
  runId,
  sessionId,
  sequenceFactory,
} from "./fixture.js";

afterEach(cleanupManagedFixtures);

describe("managed execution admission transaction", () => {
  it("rejects a stale second writer before appending another request batch", async () => {
    const fixture = await createManagedFixture();
    const second = await SQLiteEventStore.open({
      path: fixture.store.path,
      projectId,
      writableEventSchemaVersion: 2,
    });
    const coordinates = { projectId, runId, sessionId, roleId: role.roleId };
    const specs = runRequestedSpecs({
      requestDigest: `sha256:${"a".repeat(64)}`,
      roleId: role.roleId,
      risk: "low",
      policyVersion,
      occurredAt: "2026-08-18T01:00:00Z",
    });
    try {
      expect(second.list({ runId })).toEqual([]);
      new ManagedTelemetryRecorder(
        fixture.store,
        coordinates,
        policyVersion,
        sequenceFactory("evt_first"),
      ).append(specs);
      expect(() =>
        new ManagedTelemetryRecorder(
          second,
          coordinates,
          policyVersion,
          sequenceFactory("evt_second"),
        ).append(specs),
      ).toThrow("atomically");
      expect(fixture.store.list({ runId }).map((event) => event.type)).toEqual([
        "run.requested",
        "run.resolved",
      ]);
    } finally {
      second.close();
      fixture.store.close();
    }
  });
});
