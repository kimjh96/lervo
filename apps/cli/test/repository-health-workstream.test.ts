import type { ProjectStorage } from "@lervo/project-storage";
import {
  readCurrentWorkstreamState,
  restoreCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import type { EventEnvelope, WorkstreamSnapshot } from "@lervo/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { readHealthWorkstream } from "../src/repository-health-workstream.js";

vi.mock("@lervo/repository-knowledge", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge")>()),
  readCurrentWorkstreamState: vi.fn(),
  restoreCurrentWorkstreamState: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

it("never recovers missing current state from historical events", async () => {
  vi.mocked(readCurrentWorkstreamState).mockResolvedValue(null);
  const list = vi.fn();
  const storage = {
    paths: { repositoryRoot: "/fixture" },
    events: { list },
  } as unknown as ProjectStorage;
  expect(await readHealthWorkstream(storage)).toEqual({ snapshot: null, coverage: "unavailable" });
  expect(list).not.toHaveBeenCalled();
  expect(restoreCurrentWorkstreamState).not.toHaveBeenCalled();
});

it("bounds typed provenance reads to 10,001 and refuses an incomplete history", async () => {
  vi.mocked(readCurrentWorkstreamState).mockResolvedValue({
    snapshot: { workstreamId: "one" } as WorkstreamSnapshot,
    content: "{}",
    contentHash: `sha256:${"a".repeat(64)}`,
  });
  const list = vi.fn(({ afterSeq = 0, limit = 1000 }) =>
    Array.from(
      { length: limit },
      (_, i) =>
        ({
          seq: afterSeq + i + 1,
          type: "workstream.snapshot.recorded",
          payload: { workstreamId: "one" },
        }) as unknown as EventEnvelope,
    ),
  );
  const storage = {
    paths: { repositoryRoot: "/fixture" },
    events: { list },
  } as unknown as ProjectStorage;
  expect(await readHealthWorkstream(storage)).toEqual({ snapshot: null, coverage: "unavailable" });
  expect(list.mock.calls.reduce((sum, [options]) => sum + options.limit!, 0)).toBe(10_001);
  expect(list.mock.calls).toHaveLength(11);
  for (const [options] of list.mock.calls)
    expect(options).toMatchObject({ types: ["workstream.snapshot.recorded"] });
  expect(restoreCurrentWorkstreamState).not.toHaveBeenCalled();
});
