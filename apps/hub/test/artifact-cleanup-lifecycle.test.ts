import { createServer } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { attachHubArtifactCleanupLifecycle } from "../src/index.js";

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

describe("Hub artifact cleanup server lifecycle", () => {
  it("starts on listening and stops the wait when the HTTP server closes", async () => {
    const server = createServer((_request, response) => response.end());
    let waiting!: () => void;
    const waitStarted = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const claim = vi.fn(async () => ({
      status: "waiting" as const,
      reason: "not_due" as const,
      nextAttemptAt: "2026-08-22T01:00:00.000Z",
    }));
    const lifecycle = attachHubArtifactCleanupLifecycle({
      server,
      runtime: {
        schedule: {
          claimArtifactCleanupCycle: claim,
          async completeArtifactCleanupCycle() {
            throw new Error("not called");
          },
          async failArtifactCleanupCycle() {
            throw new Error("not called");
          },
        },
        repository: {
          async claimExpiredArtifacts() {
            throw new Error("not called");
          },
          async claimOrphanArtifact() {
            throw new Error("not called");
          },
          async completeArtifactPurge() {
            throw new Error("not called");
          },
          async releaseArtifactPurgeClaim() {
            throw new Error("not called");
          },
        },
        artifacts: {
          async put() {
            throw new Error("not called");
          },
          async get() {
            throw new Error("not called");
          },
          async listObjects() {
            throw new Error("not called");
          },
          async deleteObject() {
            throw new Error("not called");
          },
        },
        workerId: "hub:server-lifecycle",
        now: () => "2026-08-22T00:00:00.000Z",
        wait: {
          wait: async (_delay, signal) => {
            waiting();
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            );
          },
        },
      },
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    await waitStarted;
    await close(server);
    await expect(lifecycle.settled).resolves.toMatchObject({
      status: "stopped",
      loop: { claimedCycleCount: 0 },
    });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("reports only a fixed failure code when the runtime cannot start", async () => {
    const server = createServer();
    const onFailure = vi.fn();
    const lifecycle = attachHubArtifactCleanupLifecycle({
      server,
      runtime: {
        schedule: {
          async claimArtifactCleanupCycle() {
            throw new Error("database password");
          },
          async completeArtifactCleanupCycle() {
            throw new Error("not called");
          },
          async failArtifactCleanupCycle() {
            throw new Error("not called");
          },
        },
        repository: {
          async claimExpiredArtifacts() {
            throw new Error("not called");
          },
          async claimOrphanArtifact() {
            throw new Error("not called");
          },
          async completeArtifactPurge() {
            throw new Error("not called");
          },
          async releaseArtifactPurgeClaim() {
            throw new Error("not called");
          },
        },
        artifacts: {
          async put() {
            throw new Error("not called");
          },
          async get() {
            throw new Error("not called");
          },
          async listObjects() {
            throw new Error("not called");
          },
          async deleteObject() {
            throw new Error("not called");
          },
        },
        workerId: "hub:server-failure",
      },
      onFailure,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    await expect(lifecycle.settled).resolves.toEqual({
      status: "failed",
      failureCode: "artifact_cleanup_runtime_failed",
    });
    expect(onFailure).toHaveBeenCalledWith("artifact_cleanup_runtime_failed");
    await close(server);
  });
});
