import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositorySnapshotGitIgnoredPaths } from "../src/repository-snapshot-git.js";

const ports = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(() => undefined, { [promisify.custom]: ports.execute }) };
});
beforeEach(() => vi.resetAllMocks());

describe("Git ignored-path availability", () => {
  it("retains an empty successful listing as available", async () => {
    ports.execute.mockResolvedValueOnce({ stdout: "true\n" }).mockResolvedValueOnce({ stdout: "" });
    expect(await repositorySnapshotGitIgnoredPaths("/repository")).toEqual({
      status: "available",
      paths: new Set(),
    });
  });

  it("does not turn an ignored-path subprocess timeout into an empty set", async () => {
    ports.execute
      .mockResolvedValueOnce({ stdout: "true\n" })
      .mockRejectedValueOnce({ killed: true, signal: "SIGTERM" });
    expect(await repositorySnapshotGitIgnoredPaths("/repository")).toEqual({
      status: "unavailable",
    });
  });

  it("bounds both subprocess timeouts by the remaining snapshot deadline", async () => {
    ports.execute
      .mockResolvedValueOnce({ stdout: "true\n" })
      .mockResolvedValueOnce({ stdout: "out/\0" });
    const deadline = performance.now() + 100;
    const result = await repositorySnapshotGitIgnoredPaths("/repository", deadline);
    expect(result).toEqual({ status: "available", paths: new Set(["out/"]) });
    for (const call of ports.execute.mock.calls) {
      expect(call[2].timeout).toBeGreaterThan(0);
      expect(call[2].timeout).toBeLessThanOrEqual(100);
    }
  });

  it.each([
    { code: "ENOENT" },
    { code: 128, stderr: "fatal: not a git repository: /private/missing\n" },
    { code: 128, stderr: "fatal: detected dubious ownership\n" },
  ])("keeps unavailable probes closed", async (error) => {
    ports.execute.mockRejectedValue(error);
    expect(await repositorySnapshotGitIgnoredPaths("/repository")).toEqual({
      status: "unavailable",
    });
  });
});
