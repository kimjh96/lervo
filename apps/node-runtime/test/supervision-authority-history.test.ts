import { rename, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import { sqliteRow } from "../src/sqlite-row.js";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupervisionAuthorityHistory } from "../src/supervision-authority-history.js";
import { observeNodeSupervisionRecoveryAuthority } from "../src/supervision-authority.js";
import { projectId } from "../../../packages/work-controller/test/fixtures.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { scopedHistoryFixture } from "./supervision-scoped-history.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const f = await supervisionFixture(roots);
  const storage = await openProjectStorage(f.root);
  let at = Date.now();
  const reader = new SupervisionAuthorityHistory(
    storage.events,
    storage.paths.eventDatabase,
    storage.manifest.projectId,
    () => at,
  );
  return {
    ...f,
    storage,
    reader,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

describe("incremental supervision authority history", () => {
  it("audits a slow historical chain before the bounded recovery observation", async () => {
    const f = await fixture();
    try {
      let elapsed = 0;
      const base = Date.now();
      const read = f.reader.read.bind(f.reader);
      let calls = 0;
      vi.spyOn(f.reader, "read").mockImplementation(async () => {
        calls += 1;
        if (calls === 1) elapsed += 6_000;
        return read();
      });
      const observed = await observeNodeSupervisionRecoveryAuthority(
        f.storage,
        f.binding,
        () => new Date(base + elapsed).toISOString(),
        f.reader,
      );
      expect(observed.source.workstreamId).toBe(f.binding.workstreamId);
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      await f.storage.close();
    }
  });

  it("retries one slow authority observation with a fresh five-second window", async () => {
    const f = await fixture();
    try {
      let elapsed = 0;
      const base = Date.now();
      const read = f.reader.read.bind(f.reader);
      let calls = 0;
      vi.spyOn(f.reader, "read").mockImplementation(async () => {
        calls += 1;
        if (calls === 2) elapsed += 6_000;
        return read();
      });
      const observed = await observeNodeSupervisionRecoveryAuthority(
        f.storage,
        f.binding,
        () => new Date(base + elapsed).toISOString(),
        f.reader,
      );
      expect(observed.source.workstreamId).toBe(f.binding.workstreamId);
      expect(observed.observedAt).toBe(new Date(base + 6_000).toISOString());
      expect(calls).toBeGreaterThanOrEqual(3);
    } finally {
      await f.storage.close();
    }
  });

  it("rejects authority when both bounded observations exceed five seconds", async () => {
    const f = await fixture();
    try {
      let elapsed = 0;
      const base = Date.now();
      const read = f.reader.read.bind(f.reader);
      let calls = 0;
      vi.spyOn(f.reader, "read").mockImplementation(async () => {
        calls += 1;
        if (calls === 2 || calls === 3) elapsed += 6_000;
        return read();
      });
      await expect(
        observeNodeSupervisionRecoveryAuthority(
          f.storage,
          f.binding,
          () => new Date(base + elapsed).toISOString(),
          f.reader,
        ),
      ).rejects.toMatchObject({ code: "supervision_authority_changed" });
      expect(calls).toBeGreaterThanOrEqual(3);
    } finally {
      await f.storage.close();
    }
  });

  it("reuses detached verified authority rows and reads only the appended chain", async () => {
    const f = await fixture();
    try {
      const first = await f.reader.read();
      const expected = structuredClone(first);
      first[0]!.payload.fixtureMutation = true;
      const head = f.storage.events.latest()!;
      const list = vi.spyOn(f.storage.events, "list");
      expect(await f.reader.read()).toEqual(expected);
      expect(list).not.toHaveBeenCalled();
      f.storage.events.append({
        eventId: `evt_${"c".repeat(32)}`,
        projectId: f.owner.projectId,
        runId: "run_history_fixture",
        sessionId: "ses_history_fixture",
        schemaVersion: 1,
        type: "run.requested",
        occurredAt: new Date().toISOString(),
        actor: { kind: "system" },
        policyVersion: `sha256:${"a".repeat(64)}`,
        payload: {},
      });
      expect(await f.reader.read()).toEqual(expected);
      expect(list.mock.calls).toEqual([[{ afterSeq: head.seq, limit: 1000 }]]);
    } finally {
      await f.storage.close();
    }
  });

  it("schedules a tail audit after each read and re-proves history only every 900 seconds", async () => {
    const f = await fixture();
    try {
      await f.reader.read();
      const first = f.reader.nextAuditAt()!;
      const list = vi.spyOn(f.storage.events, "list");
      for (let minute = 1; minute <= 14; minute += 1) {
        f.advance(60_000);
        await f.reader.read();
        expect(f.reader.nextAuditAt()).toBe(first + minute * 60_000);
      }
      expect(list.mock.calls.some(([options]) => options?.afterSeq === 0)).toBe(false);
      f.advance(60_000);
      await f.reader.read();
      expect(list.mock.calls.some(([options]) => options?.afterSeq === 0)).toBe(true);
    } finally {
      await f.storage.close();
    }
  });

  it("observes an appended authority event on the tail audit without a full re-read", async () => {
    const f = await fixture();
    try {
      let at = Date.now();
      const reader = new SupervisionAuthorityHistory(
        f.storage.events,
        f.storage.paths.eventDatabase,
        f.storage.manifest.projectId,
        () => at,
        "execution",
      );
      const before = await reader.read();
      const head = f.storage.events.latest()!;
      at += 60_000;
      f.storage.events.append({
        eventId: `evt_${"9".repeat(32)}`,
        projectId: f.owner.projectId,
        runId: "run_history_fixture",
        sessionId: "ses_history_fixture",
        schemaVersion: 1,
        type: "run.requested",
        occurredAt: new Date().toISOString(),
        actor: { kind: "system" },
        policyVersion: `sha256:${"a".repeat(64)}`,
        payload: {},
      });
      const list = vi.spyOn(f.storage.events, "list");
      const after = await reader.read();
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)!.eventId).toBe(`evt_${"9".repeat(32)}`);
      expect(list.mock.calls).toEqual([[{ afterSeq: head.seq, limit: 1000 }]]);
    } finally {
      await f.storage.close();
    }
  });

  it.each([900_000, -1])(
    "revalidates historical bytes on audit expiry or clock rollback (%s)",
    async (advance) => {
      const f = await fixture();
      try {
        await f.reader.read();
        const raw = new DatabaseSync(f.storage.paths.eventDatabase);
        const original = sqliteRow(
          raw.prepare("SELECT payload_json FROM events WHERE seq = 1").get(),
        )!.payload_json;
        const setPayload = (payload: unknown) =>
          raw.prepare("UPDATE events SET payload_json = ? WHERE seq = 1").run(payload as string);
        try {
          raw.exec("DROP TRIGGER events_no_update");
          setPayload(JSON.stringify({ ...JSON.parse(String(original)), changedHistory: true }));
          f.advance(advance);
          // The audit rereads history from the first event, where the store rejects the change.
          await expect(f.reader.read()).rejects.toMatchObject({ code: "integrity_failed" });
          setPayload(original);
        } finally {
          raw.close();
        }
        expect((await f.reader.read()).length).toBeGreaterThan(0);
      } finally {
        await f.storage.close();
      }
    },
  );

  it("follows events a worker appends during the observation instead of failing", async () => {
    const f = await fixture();
    try {
      const append = (id: string) =>
        f.storage.events.append({
          eventId: `evt_${id.repeat(32)}`,
          projectId: f.owner.projectId,
          runId: "run_history_fixture",
          sessionId: "ses_history_fixture",
          schemaVersion: 1,
          type: "run.requested",
          occurredAt: new Date().toISOString(),
          actor: { kind: "system" },
          policyVersion: `sha256:${"a".repeat(64)}`,
          payload: {},
        });
      const list = f.storage.events.list.bind(f.storage.events);
      let appended = 0;
      vi.spyOn(f.storage.events, "list").mockImplementation((options) => {
        const rows = list(options);
        // Two concurrent appends land while the first passes read the chain.
        if (appended < 2) append(["d", "e"][appended++]!);
        return rows;
      });
      await f.reader.read();
      expect(appended).toBe(2);
      expect(f.storage.events.latest()!.eventId).toBe(`evt_${"e".repeat(32)}`);
    } finally {
      await f.storage.close();
    }
  });

  it("requires reopening after the database file is replaced", async () => {
    const f = await fixture();
    try {
      await f.reader.read();
      await rename(f.storage.paths.eventDatabase, `${f.storage.paths.eventDatabase}.before`);
      await writeFile(f.storage.paths.eventDatabase, "replacement");
      await expect(f.reader.read()).rejects.toThrow("database was replaced");
      await expect(f.reader.read()).rejects.toThrow("database was replaced");
    } finally {
      await f.storage.close();
    }
  });

  it("streams a chain beyond 100,000 events and retains only authority rows", async () => {
    const f = await scopedHistoryFixture(roots);
    const runId = "run_111111111111111111111111";
    f.append("workstream.snapshot.recorded", runId);
    for (let index = 0; index < 100_050; index += 1) f.append("adapter.started", runId);
    f.append("organization.team.bound", runId);
    const authority = (rows: typeof f.rows) => rows.filter((row) => row.type !== "adapter.started");
    let at = Date.now();
    const reader = new SupervisionAuthorityHistory(f.events, f.databasePath, projectId, () => at);
    expect(await reader.read()).toEqual(authority(f.rows));

    // An appended authority change is read from the anchor without re-streaming history.
    const head = f.rows.at(-1)!.seq;
    f.append("work.supervision.mandate.installed", runId);
    const list = vi.spyOn(f.events, "list");
    at += 60_000;
    expect(await reader.read()).toEqual(authority(f.rows));
    expect(list.mock.calls).toEqual([[{ afterSeq: head, limit: 1000 }]]);

    // A rolled-back store fails the anchor and is re-streamed from the first event.
    f.rows.splice(50_000);
    expect(await reader.read()).toEqual(authority(f.rows));

    // The periodic audit re-proves every link below the anchor.
    for (let index = 0; index < 60_000; index += 1) f.append("adapter.started", runId);
    expect(await reader.read()).toHaveLength(1);
    const rewritten = { ...eventWithoutHash(f.rows[70_000]!), previousHash: f.rows[0]!.eventHash };
    f.rows[70_000] = { ...rewritten, eventHash: computeEventHash(rewritten) };
    at += 60_000;
    expect(await reader.read()).toHaveLength(1);
    at += 900_000;
    await expect(reader.read()).rejects.toThrow("event chain is invalid");
  }, 60_000);
});
