import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { FileSystemCas } from "@lervo/cas";
import type { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { EventEnvelope } from "@lervo/schemas";
import { expect, it, vi } from "vitest";
import { NodeWorkstreamReplicationLocalPort } from "../src/workstream-replication.js";
import { NodeWorkstreamReplicationLocalPort as Baseline } from "./workstream-baseline.fixture.js";

const root = process.env.LERVO_RUNTIME_BENCHMARK_ROOT;

// Opt-in read-only observation; this never launches a runtime or opens a writable event store.
it.skipIf(root === undefined)(
  "compares the frozen baseline with warm reads over the same repository history",
  async () => {
    const path = resolve(root!, ".lervo/data/events.sqlite");
    const database = new DatabaseSync(path, { readOnly: true });
    let eventRows = 0;
    let casReads = 0;
    let casBytes = 0;
    function decode(row: Record<string, unknown> | undefined): EventEnvelope | null {
      if (row === undefined) return null;
      return {
        eventId: row.event_id,
        projectId: row.project_id,
        seq: row.seq,
        runId: row.run_id,
        sessionId: row.session_id,
        type: row.type,
        occurredAt: row.occurred_at,
        actor: JSON.parse(String(row.actor_json)),
        schemaVersion: row.schema_version,
        policyVersion: row.policy_version,
        payload: JSON.parse(String(row.payload_json)),
        previousHash: row.previous_hash,
        eventHash: row.event_hash,
      } as EventEnvelope;
    }
    const events = {
      path,
      list: ({ afterSeq = 0, limit = 100 } = {}) => {
        const rows = database
          .prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?")
          .all(afterSeq, limit);
        eventRows += rows.length;
        return rows.map((row) => decode(row)!);
      },
      latest: () =>
        decode(database.prepare("SELECT * FROM events ORDER BY seq DESC LIMIT 1").get()),
      get: (id: string) =>
        decode(database.prepare("SELECT * FROM events WHERE event_id = ?").get(id)),
    } as unknown as SQLiteEventStore;
    const cas = await FileSystemCas.open(resolve(root!, ".lervo/data/cas"));
    const measured = cas as unknown as { verifyObject(hash: string): Promise<Uint8Array> };
    const verify = measured.verifyObject.bind(cas);
    vi.spyOn(measured, "verifyObject").mockImplementation(async (hash) => {
      const bytes = await verify(hash);
      casReads += 1;
      casBytes += bytes.byteLength;
      return bytes;
    });
    const artifacts = cas;
    const projectId = events.latest()!.projectId;
    const old = new Baseline(root!, projectId, events, artifacts);
    const next = new NodeWorkstreamReplicationLocalPort(root!, projectId, events, artifacts);
    const samples: Array<Record<string, unknown>> = [];
    async function measure(label: string, reader: Baseline | NodeWorkstreamReplicationLocalPort) {
      eventRows = 0;
      casReads = 0;
      casBytes = 0;
      const cpu = process.cpuUsage();
      const start = performance.now();
      const revisions = await reader.readRevisionChain();
      const elapsedMs = performance.now() - start;
      const used = process.cpuUsage(cpu);
      const result = {
        label,
        head: revisions.at(-1)?.snapshotContentHash,
        revisions: revisions.length,
        eventRows,
        casReads,
        casBytes,
        cpuMs: (used.user + used.system) / 1_000,
        elapsedMs,
      };
      samples.push(result);
      return result;
    }
    try {
      database.exec("BEGIN");
      for (let i = 0; i < 3; i += 1) await measure("baseline", old);
      await measure("cold", next);
      for (let i = 0; i < 3; i += 1) {
        const hot = await measure("warm", next);
        expect(hot.head).toBe(samples[0]!.head);
        expect(hot.eventRows).toBe(0);
        expect(hot.casReads).toBe(0);
      }
      const windows = [];
      for (const [label, reader] of [
        ["baseline", old],
        ["warm", next],
      ] as const) {
        eventRows = 0;
        casReads = 0;
        casBytes = 0;
        const start = performance.now();
        const cpu = process.cpuUsage();
        let cycles = 0;
        while (performance.now() - start < 20_000) {
          await reader.readRevisionChain();
          cycles += 1;
          const remaining = 20_000 - (performance.now() - start);
          if (remaining > 0)
            await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, remaining)));
        }
        const elapsedMs = performance.now() - start;
        const used = process.cpuUsage(cpu);
        windows.push({
          label,
          cycles,
          elapsedMs,
          cpuMs: (used.user + used.system) / 1_000,
          oneCorePercent: (used.user + used.system) / (elapsedMs * 10),
          eventRows,
          casReads,
          casBytes,
        });
      }
      console.info(
        JSON.stringify({
          platform: process.platform,
          architecture: process.arch,
          node: process.version,
          samples,
          windows,
        }),
      );
    } finally {
      database.close();
    }
  },
  60_000,
);
