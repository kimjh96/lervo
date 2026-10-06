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

  it("holds an outdated writer with its reason and resumes once the coordinate selects 4", async () => {
    const { start, stop } = hold();
    const versions = [3, 3, 4];
    const failures: unknown[] = [];
    const admitted = await awaitKnowledgeWorkerAdmission({
      repositoryRoot: "/repository",
      workerId: "node-1-2",
      initialSchemaVersion: 3,
      signal: new AbortController().signal,
      onFailure: (error) => failures.push(error),
      readSchemaVersion: async () => {
        const version = versions.shift();
        if (version === undefined) throw new Error("read past the end");
        return version;
      },
      pollMilliseconds: 1,
      startHold: start,
    });
    expect(admitted).toBe(true);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryRoot: "/repository", reason: "event_schema_outdated" }),
    );
    expect(stop).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
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
      pollMilliseconds: 60_000,
      startHold: start,
    });
    controller.abort();
    expect(await waiting).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
