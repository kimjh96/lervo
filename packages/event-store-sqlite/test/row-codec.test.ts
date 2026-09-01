import { describe, expect, it } from "vitest";

import { rowToEvent, type SqliteRow } from "../src/row-codec.js";

function row(schemaVersion: number): SqliteRow {
  return {
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
    event_hash: `sha256:${"c".repeat(64)}`,
  };
}

describe("SQLite event row compatibility", () => {
  it("reads a stored v2 envelope without changing it", () => {
    expect(rowToEvent(row(2))).toMatchObject({
      schemaVersion: 2,
      type: "work.causality.recorded",
      payload: { relationship: "root" },
    });
  });

  it("reports an unsupported stored version distinctly", () => {
    expect(() => rowToEvent(row(3))).toThrowError(
      expect.objectContaining({ code: "event_schema_unsupported" }),
    );
  });
});
