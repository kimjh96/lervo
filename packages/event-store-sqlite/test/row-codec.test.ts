import { computeEventHash, type EventHashInput } from "@lervo/event-contract";
import { describe, expect, it } from "vitest";

import { rowToEvent } from "../src/row-codec.js";
import { type SqliteRow } from "../src/sqlite-row.js";

function row(schemaVersion: number): SqliteRow {
  const stored = {
    event_id: "evt_stored_compatibility_01",
    project_id: "prj_stored_compatibility_01",
    run_id: "run_stored_compatibility_01",
    session_id: "ses_stored_compatibility_01",
    seq: 1,
    type: schemaVersion === 2 ? "work.causality.recorded" : "run.requested",
    occurred_at: "2026-09-01T00:00:00.000Z",
    actor_json: JSON.stringify({ kind: "system" }),
    schema_version: schemaVersion,
    policy_version: `sha256:${"a".repeat(64)}`,
    payload_json: JSON.stringify(
      schemaVersion === 2
        ? {
            workId: `wrk_${"b".repeat(24)}`,
            executionContractVersion: 1,
            relationship: "root",
            parentRunId: null,
            retryOfRunId: null,
            attemptOrdinal: 1,
            workstreamId: null,
            assignmentId: null,
            agentId: null,
          }
        : {},
    ),
    previous_hash: null,
  };
  // Supported rows carry their real hash; an unsupported version is rejected before hashing.
  const eventHash =
    schemaVersion > 8
      ? `sha256:${"c".repeat(64)}`
      : computeEventHash({
          eventId: stored.event_id,
          projectId: stored.project_id,
          runId: stored.run_id,
          sessionId: stored.session_id,
          seq: stored.seq,
          type: stored.type,
          occurredAt: stored.occurred_at,
          actor: JSON.parse(stored.actor_json),
          schemaVersion,
          policyVersion: stored.policy_version,
          payload: JSON.parse(stored.payload_json),
          previousHash: null,
        } as EventHashInput);
  return { ...stored, event_hash: eventHash };
}

describe("SQLite event row compatibility", () => {
  it("reads a stored v2 envelope without changing it", () => {
    expect(rowToEvent(row(2))).toMatchObject({
      schemaVersion: 2,
      type: "work.causality.recorded",
      payload: { relationship: "root" },
    });
  });

  it("rejects stored content that no longer matches its hash", () => {
    const changed = { ...row(2), occurred_at: "2026-09-02T00:00:00.000Z" };
    expect(() => rowToEvent(changed)).toThrowError(
      expect.objectContaining({ code: "integrity_failed" }),
    );
  });

  it("reports an unsupported stored version distinctly", () => {
    expect(() => rowToEvent(row(17))).toThrowError(
      expect.objectContaining({ code: "event_schema_unsupported" }),
    );
  });
});
