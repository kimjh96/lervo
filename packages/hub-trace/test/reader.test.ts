import { describe, expect, it, vi } from "vitest";

import {
  HubTraceReader,
  type HubProjectTraceSummary,
  type HubTraceSource,
} from "../src/index.js";

const project: HubProjectTraceSummary = {
  destinationId: "hub:primary",
  projectId: "prj_trace_reader_01",
  projectName: "trace-reader",
  registrationId: "hpr_aaaaaaaaaaaaaaaa",
  projectIdentityHash: "sha256:" + "a".repeat(64),
  projectManifestHash: "sha256:" + "b".repeat(64),
  registeredAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
  cursor: { seq: 0, eventHash: null },
  storedEventCount: 0,
  continuousEventCount: 0,
  bufferedEventCount: 0,
  runCount: 0,
};

function source(overrides: Partial<HubTraceSource> = {}): HubTraceSource {
  return {
    listProjects: vi.fn(async () => ({ items: [project], nextCursor: null })),
    getProject: vi.fn(async () => ({
      project,
      runs: { items: [], nextCursor: null },
    })),
    getRun: vi.fn(async () => null),
    ...overrides,
  };
}

describe("Hub trace reader", () => {
  it("normalizes bounded page requests before calling the query source", async () => {
    const querySource = source();
    const reader = new HubTraceReader(querySource);

    await expect(reader.listProjects()).resolves.toEqual({
      items: [project],
      nextCursor: null,
    });
    expect(querySource.listProjects).toHaveBeenCalledWith({ limit: 50 });

    const after = { destinationId: project.destinationId, projectId: project.projectId };
    await reader.listProjects({ after, limit: 10 });
    expect(querySource.listProjects).toHaveBeenLastCalledWith({ after, limit: 10 });
  });

  it("rejects unbounded requests before reaching the source", async () => {
    const querySource = source();
    const reader = new HubTraceReader(querySource);

    await expect(reader.listProjects({ limit: 101 })).rejects.toMatchObject({
      code: "invalid_query",
    });
    expect(querySource.listProjects).not.toHaveBeenCalled();

    await expect(reader.getRun({
      destinationId: project.destinationId,
      projectId: project.projectId,
      runId: "run_trace_01",
      after: { seq: 0 },
    })).rejects.toMatchObject({ code: "invalid_query" });
    expect(querySource.getRun).not.toHaveBeenCalled();
  });

  it("keeps project and run not-found states explicit", async () => {
    const reader = new HubTraceReader(source({
      getProject: vi.fn(async () => null),
      getRun: vi.fn(async () => null),
    }));

    await expect(reader.getProject({
      destinationId: project.destinationId,
      projectId: "prj_missing_trace_01",
    })).rejects.toMatchObject({ code: "project_not_found" });
    await expect(reader.getRun({
      destinationId: project.destinationId,
      projectId: project.projectId,
      runId: "run_missing_trace_01",
    })).rejects.toMatchObject({ code: "run_not_found" });
  });

  it("returns a defensive copy of source results", async () => {
    const shared = { items: [project], nextCursor: null };
    const reader = new HubTraceReader(source({
      listProjects: vi.fn(async () => shared),
    }));
    const result = await reader.listProjects();
    result.items[0]!.projectName = "mutated";
    expect(shared.items[0]!.projectName).toBe("trace-reader");
  });

  it("rejects a source that ignores the page limit", async () => {
    const oversized = Array.from({ length: 2 }, () => project);
    const reader = new HubTraceReader(source({
      listProjects: vi.fn(async () => ({ items: oversized, nextCursor: null })),
    }));
    await expect(reader.listProjects({ limit: 1 })).rejects.toMatchObject({
      code: "source_inconsistent",
    });
  });
});
