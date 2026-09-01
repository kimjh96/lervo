import { describe, expect, it, vi } from "vitest";
import { calculateKnowledgeGraphRelationId } from "@lervo/knowledge-graph";

import {
  HubProjectScopedTraceReader,
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
    getWork: vi.fn(async () => null),
    getKnowledgeGraph: vi.fn(async () => null),
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
    expect(querySource.listProjects).toHaveBeenCalledWith({
      scope: { mode: "all" },
      limit: 50,
    });

    const after = { destinationId: project.destinationId, projectId: project.projectId };
    await reader.listProjects({ after, limit: 10 });
    expect(querySource.listProjects).toHaveBeenLastCalledWith({
      scope: { mode: "all" },
      after,
      limit: 10,
    });
  });

  it("rejects unbounded requests before reaching the source", async () => {
    const querySource = source();
    const reader = new HubTraceReader(querySource);

    await expect(reader.listProjects({ limit: 101 })).rejects.toMatchObject({
      code: "invalid_query",
    });
    expect(querySource.listProjects).not.toHaveBeenCalled();

    await expect(
      reader.getRun({
        destinationId: project.destinationId,
        projectId: project.projectId,
        runId: "run_trace_01",
        after: { seq: 0 },
      }),
    ).rejects.toMatchObject({ code: "invalid_query" });
    expect(querySource.getRun).not.toHaveBeenCalled();
  });

  it("keeps project and run not-found states explicit", async () => {
    const reader = new HubTraceReader(
      source({
        getProject: vi.fn(async () => null),
        getRun: vi.fn(async () => null),
      }),
    );

    await expect(
      reader.getProject({
        destinationId: project.destinationId,
        projectId: "prj_missing_trace_01",
      }),
    ).rejects.toMatchObject({ code: "project_not_found" });
    await expect(
      reader.getRun({
        destinationId: project.destinationId,
        projectId: project.projectId,
        runId: "run_missing_trace_01",
      }),
    ).rejects.toMatchObject({ code: "run_not_found" });
  });

  it("returns a defensive copy of source results", async () => {
    const shared = { items: [project], nextCursor: null };
    const reader = new HubTraceReader(
      source({
        listProjects: vi.fn(async () => shared),
      }),
    );
    const result = await reader.listProjects();
    result.items[0]!.projectName = "mutated";
    expect(shared.items[0]!.projectName).toBe("trace-reader");
  });

  it("rejects a source that ignores the page limit", async () => {
    const oversized = Array.from({ length: 2 }, () => project);
    const reader = new HubTraceReader(
      source({
        listProjects: vi.fn(async () => ({ items: oversized, nextCursor: null })),
      }),
    );
    await expect(reader.listProjects({ limit: 1 })).rejects.toMatchObject({
      code: "source_inconsistent",
    });
  });

  it("passes only the normalized authorized project scope to the source", async () => {
    const querySource = source();
    const reader = new HubProjectScopedTraceReader(querySource, [
      { destinationId: "hub:secondary", projectId: "prj_secondary" },
      { destinationId: project.destinationId, projectId: project.projectId },
      { destinationId: project.destinationId, projectId: project.projectId },
    ]);

    await reader.listProjects();

    expect(querySource.listProjects).toHaveBeenCalledWith({
      scope: {
        mode: "projects",
        projects: [
          { destinationId: project.destinationId, projectId: project.projectId },
          { destinationId: "hub:secondary", projectId: "prj_secondary" },
        ],
      },
      limit: 50,
    });
  });

  it("rejects a project outside the authorized scope before calling the source", async () => {
    const querySource = source();
    const reader = new HubProjectScopedTraceReader(querySource, [
      {
        destinationId: project.destinationId,
        projectId: project.projectId,
      },
    ]);

    await expect(
      reader.getProject({
        destinationId: project.destinationId,
        projectId: "prj_forbidden",
      }),
    ).rejects.toMatchObject({ code: "project_forbidden" });
    await expect(
      reader.getRun({
        destinationId: project.destinationId,
        projectId: "prj_forbidden",
        runId: "run_forbidden",
      }),
    ).rejects.toMatchObject({ code: "project_forbidden" });

    expect(querySource.getProject).not.toHaveBeenCalled();
    expect(querySource.getRun).not.toHaveBeenCalled();
  });

  it("fails closed when a scoped source returns an unauthorized project", async () => {
    const querySource = source({
      listProjects: vi.fn(async () => ({
        items: [{ ...project, projectId: "prj_forbidden" }],
        nextCursor: null,
      })),
    });
    const reader = new HubProjectScopedTraceReader(querySource, [
      {
        destinationId: project.destinationId,
        projectId: project.projectId,
      },
    ]);

    await expect(reader.listProjects()).rejects.toMatchObject({
      code: "source_inconsistent",
    });
  });

  it("bounds a focused graph page and rejects unrelated source relations", async () => {
    const focus = { kind: "project" as const, id: project.projectId };
    const target = { kind: "run" as const, id: "run_graph_reader_01" };
    const relation = {
      schemaVersion: 1 as const,
      relationId: calculateKnowledgeGraphRelationId({
        projectId: project.projectId,
        type: "contains_run",
        from: focus,
        to: target,
      }),
      projectId: project.projectId,
      type: "contains_run" as const,
      from: focus,
      to: target,
      evidence: {
        eventId: "evt_graph_reader_01",
        eventType: "run.requested" as const,
        runId: target.id,
        seq: 1,
      },
    };
    const querySource = source({
      getKnowledgeGraph: vi.fn(async () => ({
        project,
        focus,
        relations: { items: [relation], nextCursor: null },
      })),
    });
    const reader = new HubProjectScopedTraceReader(querySource, [
      {
        destinationId: project.destinationId,
        projectId: project.projectId,
      },
    ]);

    await expect(
      reader.getKnowledgeGraph({
        destinationId: project.destinationId,
        projectId: project.projectId,
        focus,
        limit: 1,
      }),
    ).resolves.toMatchObject({ relations: { items: [{ type: "contains_run" }] } });
    expect(querySource.getKnowledgeGraph).toHaveBeenCalledWith({
      scope: {
        mode: "projects",
        projects: [
          {
            destinationId: project.destinationId,
            projectId: project.projectId,
          },
        ],
      },
      destinationId: project.destinationId,
      projectId: project.projectId,
      focus,
      limit: 1,
    });

    vi.mocked(querySource.getKnowledgeGraph).mockResolvedValue({
      project,
      focus,
      relations: {
        items: [{ ...relation, from: { kind: "project", id: "prj_unrelated" } }],
        nextCursor: null,
      },
    });
    await expect(
      reader.getKnowledgeGraph({
        destinationId: project.destinationId,
        projectId: project.projectId,
        focus,
      }),
    ).rejects.toMatchObject({ code: "source_inconsistent" });
  });

  it("rejects unauthorized graph focus before calling the source", async () => {
    const querySource = source();
    const reader = new HubProjectScopedTraceReader(querySource, [
      {
        destinationId: project.destinationId,
        projectId: project.projectId,
      },
    ]);
    await expect(
      reader.getKnowledgeGraph({
        destinationId: project.destinationId,
        projectId: "prj_forbidden",
        focus: { kind: "project", id: "prj_forbidden" },
      }),
    ).rejects.toMatchObject({ code: "project_forbidden" });
    expect(querySource.getKnowledgeGraph).not.toHaveBeenCalled();
  });
});
