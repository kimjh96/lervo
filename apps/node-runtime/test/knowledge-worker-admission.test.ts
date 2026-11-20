import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { awaitKnowledgeWorkerAdmission } from "../src/knowledge-worker-admission.js";

function hold() {
  const stop = vi.fn(async () => undefined);
  const start = vi.fn(() => stop);
  return { start, stop };
}

describe("Node knowledge worker admission", () => {
  it("admits a schema 4 writer immediately without a hold", async () => {
    const { start } = hold();
    expect(
      await awaitKnowledgeWorkerAdmission({
        repositoryRoot: "/repository",
        workerId: "node-1-2",
        initialSchemaVersion: 4,
        signal: new AbortController().signal,
        onFailure: () => undefined,
        startHold: start,
      }),
    ).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it("holds an outdated writer, reads only when the coordinate changes, and resumes at 4 (ADR-0602)", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-admission-"));
    try {
      const coordinatePath = join(root, "event-contract.json");
      await writeFile(coordinatePath, "3");
      const { start, stop } = hold();
      const reads = vi.fn(async () => Number(await readFile(coordinatePath, "utf8")));
      const waiting = awaitKnowledgeWorkerAdmission({
        repositoryRoot: root,
        workerId: "node-1-2",
        initialSchemaVersion: 3,
        signal: new AbortController().signal,
        onFailure: () => undefined,
        readSchemaVersion: reads,
        coordinatePath,
        startHold: start,
      });
      // One read right after the watch is armed; then nothing until the file changes.
      await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
      await new Promise((settle) => setTimeout(settle, 300));
      expect(reads).toHaveBeenCalledTimes(1);
      // An activation rewrites the coordinate; the change is read and admits the resident.
      await vi.waitFor(
        async () => {
          await writeFile(coordinatePath, "4");
          expect(reads.mock.calls.length).toBeGreaterThan(1);
        },
        { timeout: 5_000 },
      );
      expect(await waiting).toBe(true);
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryRoot: root, reason: "event_schema_outdated" }),
      );
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retries a failed coordinate read with a growing delay, with one abort listener (ADR-0602)", async () => {
    vi.useFakeTimers();
    try {
      const { start } = hold();
      let calls = 0;
      const at: number[] = [];
      const reads = vi.fn(async () => {
        calls++;
        at.push(Date.now());
        if (calls < 4) throw new Error("coordinate unreadable");
        return 4;
      });
      const controller = new AbortController();
      const listeners = vi.spyOn(controller.signal, "addEventListener");
      const failures: unknown[] = [];
      const begin = Date.now();
      const waiting = awaitKnowledgeWorkerAdmission({
        repositoryRoot: "/repository",
        workerId: "node-1-2",
        initialSchemaVersion: 3,
        signal: controller.signal,
        onFailure: (error) => failures.push(error),
        readSchemaVersion: reads,
        coordinatePath: "/repository/missing/event-contract.json",
        startHold: start,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await waiting).toBe(true);
      // Read at 0, then retried 5, 10 and 20 seconds apart.
      expect(at.map((value) => (value - begin) / 1_000)).toEqual([0, 5, 15, 35]);
      expect(failures).toHaveLength(3);
      expect(listeners.mock.calls.filter(([type]) => type === "abort")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops holding when the Node stops before activation", async () => {
    const { start, stop } = hold();
    const controller = new AbortController();
    const waiting = awaitKnowledgeWorkerAdmission({
      repositoryRoot: "/repository",
      workerId: "node-1-2",
      initialSchemaVersion: 1,
      signal: controller.signal,
      onFailure: () => undefined,
      readSchemaVersion: async () => 1,
      startHold: start,
    });
    controller.abort();
    expect(await waiting).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
