import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  eventStoreChannelDirectory,
  type EventDraftV1,
  SQLiteEventStore,
} from "@lervo/event-store-sqlite";
import { afterEach, expect, it, vi } from "vitest";

import { watchResidentEventChanges } from "../src/resident-event-wakeup.js";

const projectId = "prj_01234567";
const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function draft(index: number): EventDraftV1 {
  return {
    eventId: `evt_${String(index).padStart(8, "0")}`,
    projectId,
    runId: "run_01234567",
    sessionId: "ses_01234567",
    type: "run.completed",
    occurredAt: `2026-08-18T00:00:${String(index).padStart(2, "0")}Z`,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: `sha256:${"a".repeat(64)}`,
    payload: {
      resultDigest: `sha256:${"b".repeat(64)}`,
      artifactIds: [`art_${"b".repeat(64)}`],
      verificationStatus: "not_run",
    },
  };
}

/** Counts every call the resident's watch makes on the store. */
function counted(store: SQLiteEventStore) {
  const calls: string[] = [];
  const proxy = new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...input: unknown[]) => {
        calls.push(String(property));
        return value.apply(target, input);
      };
    },
  });
  return { proxy, calls };
}

it.skipIf(process.platform === "win32")(
  "keeps an idle store, subscriber and resident at zero reads, opens and decodes (ADR-0602)",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-resident-idle-"));
    roots.push(root);
    const path = resolve(root, ".lervo/data/events.sqlite");
    const store = await SQLiteEventStore.open({ path, projectId });
    const writer = await SQLiteEventStore.open({ path, projectId });
    try {
      store.append(draft(1));
      const { proxy, calls } = counted(store);
      const opens = vi.spyOn(SQLiteEventStore, "open");
      const readOnlyOpens = vi.spyOn(SQLiteEventStore, "openReadOnly");
      const notify = vi.fn();
      // The real FIFO channel and no directory watch: only a commit's ping can wake it.
      const stop = watchResidentEventChanges(
        { paths: { eventDatabase: path }, events: proxy } as never,
        notify,
        undefined,
        { directoryWatch: false },
      );
      try {
        // Real time first: the FIFO is held open before any simulated time passes.
        await vi.waitFor(async () =>
          expect(
            (await readdir(eventStoreChannelDirectory(path))).filter((name) =>
              name.endsWith(".fifo"),
            ),
          ).toHaveLength(1),
        );
        await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "Date"] });
        // The subscription reads the wake key once.
        const subscribed = calls.length;
        expect(subscribed).toBeGreaterThan(0);
        calls.length = 0;
        // Twelve idle hours, one simulated minute at a time.
        for (let minute = 0; minute < 12 * 60; minute += 1)
          await vi.advanceTimersByTimeAsync(60_000);
        expect(calls).toEqual([]);
        expect(opens).not.toHaveBeenCalled();
        expect(readOnlyOpens).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        // A commit through a second connection wakes the resident once.
        vi.useRealTimers();
        writer.append(draft(2));
        await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1), { timeout: 2_000 });
        expect(calls.length).toBeLessThanOrEqual(subscribed * 2);
      } finally {
        stop();
      }
    } finally {
      writer.close();
      store.close();
    }
  },
);
