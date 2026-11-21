import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync, readSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { type EventDraftV1, SQLiteEventStore } from "../src/index.js";
import { eventStoreChannelDirectory, listenEventStoreChanges } from "../src/change-channel.js";
import { localBootKey, localHostKey } from "../src/process-identity.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const roots: string[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
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
    policyVersion,
    payload: {
      resultDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      artifactIds: ["art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      verificationStatus: "not_run",
    },
  };
}

/** Bytes waiting in a raw FIFO, read without blocking: each is one writer's ping. */
function waitingPings(descriptor: number): number {
  const buffer = Buffer.alloc(65_536);
  try {
    return readSync(descriptor, buffer);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EAGAIN") return 0;
    throw error;
  }
}

it.skipIf(process.platform === "win32")(
  "pings synchronously after a committed transaction and never after a rolled-back one (ADR-0602)",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-store-ping-"));
    roots.push(root);
    const path = resolve(root, ".lervo/data/events.sqlite");
    const store = await SQLiteEventStore.open({ path, projectId });
    // A real subscriber creates the run directory; the raw FIFO beside it counts bytes exactly.
    const listener = listenEventStoreChanges(path, vi.fn(), vi.fn());
    closers.push(() => listener.close());
    // Named like a subscriber of this kernel, so writers ping it.
    const fifo = resolve(
      eventStoreChannelDirectory(path),
      `${localHostKey()}-${localBootKey()}-1-c0.fifo`,
    );
    execFileSync("mkfifo", ["-m", "600", fifo]);
    const descriptor = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
    closers.push(() => closeSync(descriptor));
    try {
      store.append(draft(1));
      // The byte is already in the pipe when append returns.
      expect(waitingPings(descriptor)).toBe(1);
      expect(() =>
        store.transact((transaction) => {
          transaction.append(draft(2));
          throw new Error("rolled back");
        }),
      ).toThrow("rolled back");
      expect(waitingPings(descriptor)).toBe(0);
      expect(store.list().map((event) => event.eventId)).toEqual([draft(1).eventId]);
    } finally {
      store.close();
    }
  },
);
