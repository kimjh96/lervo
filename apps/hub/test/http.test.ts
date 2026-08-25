import { type HubProjectTraceSummary } from "@lervo/hub-trace";
import { calculateKnowledgeGraphRelationId } from "@lervo/knowledge-graph";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allowedProject,
  closeHubTestServers,
  credentials,
  startHubTestServer,
  token,
  traceSource,
} from "./http-fixture.js";

afterEach(closeHubTestServers);

describe("Hub trace HTTP API", () => {
  it("rejects missing and invalid credentials before any trace query", async () => {
    const querySource = traceSource();
    const base = await startHubTestServer(querySource);

    const missing = await fetch(`${base}/v1/trace/projects`);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    expect(missing.headers.get("cache-control")).toBe("no-store");
    const wrongToken = "wrong-token-value-that-must-never-leak-aaaaaaaa";
    const invalid = await fetch(`${base}/v1/trace/projects`, {
      headers: { authorization: `Bearer ${wrongToken}` },
    });
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).not.toContain(wrongToken);
    expect(querySource.listProjects).not.toHaveBeenCalled();
  });

  it("passes the authenticated project scope to the source and round-trips pagination", async () => {
    const querySource = traceSource();
    const base = await startHubTestServer(querySource);
    const headers = { authorization: `Bearer ${token}` };

    const first = await fetch(`${base}/v1/trace/projects?limit=1`, { headers });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      projects: HubProjectTraceSummary[];
      nextCursor: string;
    };
    expect(firstBody.projects.map((project) => project.projectId)).toEqual(["prj_allowed01"]);
    expect(querySource.listProjects).toHaveBeenCalledWith({
      scope: {
        mode: "projects",
        projects: credentials[0]!.projects,
      },
      limit: 1,
    });

    const second = await fetch(
      `${base}/v1/trace/projects?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      { headers },
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      projects: [{ projectId: "prj_allowed02" }],
      nextCursor: null,
    });
    expect(querySource.listProjects).toHaveBeenLastCalledWith({
      scope: {
        mode: "projects",
        projects: credentials[0]!.projects,
      },
      after: {
        destinationId: allowedProject.destinationId,
        projectId: allowedProject.projectId,
      },
      limit: 1,
    });
  });

  it("returns forbidden for an out-of-scope project without reading project data", async () => {
    const querySource = traceSource();
    const base = await startHubTestServer(querySource);
    const response = await fetch(
      `${base}/v1/trace/projects/prj_forbid001?destinationId=hub%3Aprimary`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(querySource.getProject).not.toHaveBeenCalled();
  });

  it("serves authorized project and run details through the bounded source queries", async () => {
    const querySource = traceSource();
    vi.mocked(querySource.getRun).mockResolvedValue({
      project: { ...allowedProject, cursor: { seq: 0, eventHash: null } },
      run: {
        runId: "run_allowed01",
        sessionIds: ["ses_allowed01"],
        sessionCount: 1,
        sessionIdsTruncated: false,
        firstSeq: 1,
        lastSeq: 1,
        firstOccurredAt: "2026-08-19T00:00:01.000Z",
        lastOccurredAt: "2026-08-19T00:00:01.000Z",
        eventCount: 1,
        continuousEventCount: 0,
        bufferedEventCount: 1,
      },
      contextCoverage: null,
      events: {
        items: [
          {
            chainPosition: "buffered",
            event: {
              eventId: "evt_allowed01",
              projectId: allowedProject.projectId,
              runId: "run_allowed01",
              sessionId: "ses_allowed01",
              seq: 1,
              type: "run.requested",
              occurredAt: "2026-08-19T00:00:01.000Z",
              actor: { kind: "user" },
              schemaVersion: 1,
              policyVersion: "sha256:" + "d".repeat(64),
              payload: {
                requestDigest: "sha256:" + "e".repeat(64),
                role: "developer",
                risk: "low",
              },
              previousHash: null,
              eventHash: "sha256:" + "f".repeat(64),
            },
          },
        ],
        nextCursor: null,
      },
    });
    const base = await startHubTestServer(querySource);
    const headers = { authorization: `Bearer ${token}` };

    const projectResponse = await fetch(
      `${base}/v1/trace/projects/prj_allowed01?destinationId=hub%3Aprimary&limit=5`,
      { headers },
    );
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toMatchObject({
      project: { projectId: "prj_allowed01" },
      runs: [],
      nextCursor: null,
    });

    const runResponse = await fetch(
      `${base}/v1/trace/projects/prj_allowed01/runs/run_allowed01?destinationId=hub%3Aprimary`,
      { headers },
    );
    expect(runResponse.status).toBe(200);
    expect(await runResponse.json()).toMatchObject({
      run: { runId: "run_allowed01", bufferedEventCount: 1 },
      events: [{ chainPosition: "buffered" }],
      nextCursor: null,
    });
    expect(querySource.getRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { mode: "projects", projects: credentials[0]!.projects },
        destinationId: "hub:primary",
        projectId: "prj_allowed01",
        runId: "run_allowed01",
        limit: 50,
      }),
    );
  });

  it("serves only a bounded focused knowledge graph through the authorized source", async () => {
    const querySource = traceSource();
    const focus = { kind: "project" as const, id: allowedProject.projectId };
    const target = { kind: "run" as const, id: "run_allowed01" };
    const relationId = calculateKnowledgeGraphRelationId({
      projectId: allowedProject.projectId,
      type: "contains_run",
      from: focus,
      to: target,
    });
    vi.mocked(querySource.getKnowledgeGraph).mockResolvedValue({
      project: allowedProject,
      focus,
      relations: {
        items: [
          {
            schemaVersion: 1,
            relationId,
            projectId: allowedProject.projectId,
            type: "contains_run",
            from: focus,
            to: target,
            evidence: {
              eventId: "evt_allowed01",
              eventType: "run.requested",
              runId: target.id,
              seq: 1,
            },
          },
        ],
        nextCursor: { relationId },
      },
    });
    const base = await startHubTestServer(querySource);
    const response = await fetch(
      `${base}/v1/trace/projects/prj_allowed01/graph?destinationId=hub%3Aprimary&limit=1`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      focus: { kind: string; id: string };
      nodes: Array<{ kind: string; id: string }>;
      relations: Array<{ relationId: string; type: string }>;
      nextCursor: string;
    };
    expect(body.focus).toEqual(focus);
    expect(body.nodes).toEqual([focus, target]);
    expect(body.relations).toEqual(
      [{ relationId, type: "contains_run" }].map((item) => expect.objectContaining(item)),
    );
    expect(typeof body.nextCursor).toBe("string");
    expect(querySource.getKnowledgeGraph).toHaveBeenCalledWith({
      scope: { mode: "projects", projects: credentials[0]!.projects },
      destinationId: allowedProject.destinationId,
      projectId: allowedProject.projectId,
      focus,
      limit: 1,
    });

    vi.mocked(querySource.getKnowledgeGraph).mockResolvedValue({
      project: allowedProject,
      focus,
      relations: { items: [], nextCursor: null },
    });
    const next = await fetch(
      `${base}/v1/trace/projects/prj_allowed01/graph?destinationId=hub%3Aprimary&limit=1&cursor=${encodeURIComponent(body.nextCursor)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(next.status).toBe(200);
    expect(querySource.getKnowledgeGraph).toHaveBeenLastCalledWith(
      expect.objectContaining({
        after: { relationId },
        focus,
      }),
    );
  });

  it("rejects malformed queries and mismatched cursors before reading details", async () => {
    const querySource = traceSource();
    const base = await startHubTestServer(querySource);
    const headers = { authorization: `Bearer ${token}` };

    const unknown = await fetch(`${base}/v1/trace/projects?unknown=1`, { headers });
    expect(unknown.status).toBe(400);
    const eventCursor = Buffer.from(JSON.stringify({ v: 1, kind: "event", seq: 1 })).toString(
      "base64url",
    );
    const mismatched = await fetch(
      `${base}/v1/trace/projects/prj_allowed01?destinationId=hub%3Aprimary&cursor=${eventCursor}`,
      { headers },
    );
    expect(mismatched.status).toBe(400);
    expect(querySource.getProject).not.toHaveBeenCalled();
  });

  it("uses fixed route and method errors without querying trace data", async () => {
    const querySource = traceSource();
    const base = await startHubTestServer(querySource);
    const missing = await fetch(`${base}/v1/trace/unknown`);
    expect(missing.status).toBe(404);
    const method = await fetch(`${base}/v1/trace/projects`, { method: "POST" });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
    expect(querySource.listProjects).not.toHaveBeenCalled();
  });

  it("replaces an oversized authorized result with a bounded safe error", async () => {
    const querySource = traceSource();
    vi.mocked(querySource.listProjects).mockResolvedValue({
      items: [{ ...allowedProject, projectName: "a".repeat(6_000) }],
      nextCursor: null,
    });
    const base = await startHubTestServer(querySource, 1_024);
    const response = await fetch(`${base}/v1/trace/projects`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "response_too_large" } });
  });
});
