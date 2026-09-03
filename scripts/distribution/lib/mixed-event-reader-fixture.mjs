import { DatabaseSync } from "node:sqlite";

const policyVersion = `sha256:${"a".repeat(64)}`;
const workId = `wrk_${"b".repeat(24)}`;

function eventWithoutHash(projectId, seq, previousHash, overrides) {
  return {
    eventId: `evt_packed_reader_proof_${String(seq).padStart(2, "0")}`,
    projectId,
    runId: "run_packed_reader_proof_01",
    sessionId: "ses_packed_reader_proof_01",
    seq,
    occurredAt: `2026-09-01T00:00:0${seq}.000Z`,
    actor: { kind: "system" },
    policyVersion,
    previousHash,
    ...overrides,
  };
}

export function createMixedEventReaderFixture(projectId, computeEventHash) {
  const firstWithoutHash = eventWithoutHash(projectId, 1, null, {
    schemaVersion: 1,
    type: "run.requested",
    payload: {
      requestDigest: `sha256:${"c".repeat(64)}`,
      role: "developer",
      risk: "low",
    },
  });
  const first = { ...firstWithoutHash, eventHash: computeEventHash(firstWithoutHash) };
  const secondWithoutHash = eventWithoutHash(projectId, 2, first.eventHash, {
    schemaVersion: 2,
    type: "work.causality.recorded",
    payload: {
      workId,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
    },
  });
  return [first, { ...secondWithoutHash, eventHash: computeEventHash(secondWithoutHash) }];
}

export function installMixedEventReaderFixture(databasePath, events) {
  if (
    events.length !== 2 ||
    events[0]?.schemaVersion !== 1 ||
    events[1]?.schemaVersion !== 2 ||
    events[1]?.previousHash !== events[0]?.eventHash
  ) {
    throw new Error("The packed event-reader fixture must be one linked v1/v2 chain.");
  }
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    allowExtension: false,
  });
  try {
    const count = database.prepare("SELECT COUNT(*) AS count FROM events").get()?.count;
    if (count !== 0) throw new Error("The packed event-reader fixture database is not empty.");
    const insert = database.prepare(`
      INSERT INTO events (
        event_id, project_id, seq, run_id, session_id, type, occurred_at,
        actor_json, schema_version, policy_version, payload_json, previous_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    database.exec("BEGIN IMMEDIATE;");
    try {
      for (const event of events) {
        insert.run(
          event.eventId,
          event.projectId,
          event.seq,
          event.runId,
          event.sessionId,
          event.type,
          event.occurredAt,
          JSON.stringify(event.actor),
          event.schemaVersion,
          event.policyVersion,
          JSON.stringify(event.payload),
          event.previousHash,
          event.eventHash,
        );
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    database.close();
  }
}
