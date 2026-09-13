import { rename, rm, writeFile } from "node:fs/promises";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupervisionAuthorityHistory } from "../src/supervision-authority-history.js";
import { supervisionFixture } from "./supervision.fixture.js";

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

  it.each([60_000, -1])(
    "revalidates historical bytes on audit expiry or clock rollback (%s)",
    async (advance) => {
      const f = await fixture();
      try {
        await f.reader.read();
        const list = f.storage.events.list.bind(f.storage.events);
        const spy = vi.spyOn(f.storage.events, "list").mockImplementation((options) => {
          const rows = list(options);
          if (options?.afterSeq === 0) rows[0]!.payload.changedHistory = true;
          return rows;
        });
        f.advance(advance);
        await expect(f.reader.read()).rejects.toThrow("chain is invalid");
        spy.mockRestore();
        expect((await f.reader.read()).length).toBeGreaterThan(0);
      } finally {
        await f.storage.close();
      }
    },
  );

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

  it("preserves the authority source event bound before allocating history", async () => {
    const f = await fixture();
    try {
      const head = f.storage.events.latest()!;
      vi.spyOn(f.storage.events, "latest").mockReturnValue({ ...head, seq: 100_001 });
      const list = vi.spyOn(f.storage.events, "list");
      await expect(f.reader.read()).rejects.toThrow("source bound");
      expect(list).not.toHaveBeenCalled();
    } finally {
      await f.storage.close();
    }
  });
});
