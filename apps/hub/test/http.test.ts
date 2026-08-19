import { type AddressInfo } from "node:net";

import {
  type HubProjectTraceSummary,
  type HubTraceSource,
} from "@lervo/hub-trace";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfiguredBearerAuthenticator,
  createHubTraceServer,
  type HubBearerCredential,
} from "../src/index.js";

const token = "lervo-http-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const allowedProject: HubProjectTraceSummary = {
  destinationId: "hub:primary",
  projectId: "prj_allowed01",
  projectName: "허용된 project",
  registrationId: "hpr_" + "a".repeat(64),
  projectIdentityHash: "sha256:" + "b".repeat(64),
  projectManifestHash: "sha256:" + "c".repeat(64),
  registeredAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
  cursor: { seq: 0, eventHash: null },
  storedEventCount: 0,
  continuousEventCount: 0,
  bufferedEventCount: 0,
  runCount: 0,
};
const secondProject: HubProjectTraceSummary = {
  ...allowedProject,
  projectId: "prj_allowed02",
  projectName: "두 번째 project",
};
const credentials: HubBearerCredential[] = [{
  token,
  principalId: "operator:http-test",
  projects: [
    { destinationId: allowedProject.destinationId, projectId: allowedProject.projectId },
    { destinationId: secondProject.destinationId, projectId: secondProject.projectId },
  ],
}];
const openServers: ReturnType<typeof createHubTraceServer>[] = [];

function source(): HubTraceSource {
  return {
    listProjects: vi.fn(async (query) => query.after === undefined ? {
      items: [allowedProject],
      nextCursor: {
        destinationId: allowedProject.destinationId,
        projectId: allowedProject.projectId,
      },
    } : { items: [secondProject], nextCursor: null }),
    getProject: vi.fn(async () => ({
      project: allowedProject,
      runs: { items: [], nextCursor: null },
    })),
    getRun: vi.fn(async () => null),
  };
}

async function start(querySource: HubTraceSource, maxResponseBytes?: number): Promise<string> {
  const server = createHubTraceServer({
    authenticator: new ConfiguredBearerAuthenticator(credentials),
    source: querySource,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
  });
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  })));
});

describe("Hub trace HTTP API", () => {
  it("rejects missing and invalid credentials before any trace query", async () => {
    const querySource = source();
    const base = await start(querySource);

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
    const querySource = source();
    const base = await start(querySource);
    const headers = { authorization: `Bearer ${token}` };

    const first = await fetch(`${base}/v1/trace/projects?limit=1`, { headers });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
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
    const querySource = source();
    const base = await start(querySource);
    const response = await fetch(
      `${base}/v1/trace/projects/prj_forbid001?destinationId=hub%3Aprimary`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(querySource.getProject).not.toHaveBeenCalled();
  });

  it("serves authorized project and run details through the bounded source queries", async () => {
    const querySource = source();
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
      events: {
        items: [{
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
        }],
        nextCursor: null,
      },
    });
    const base = await start(querySource);
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
    expect(querySource.getRun).toHaveBeenCalledWith(expect.objectContaining({
      scope: { mode: "projects", projects: credentials[0]!.projects },
      destinationId: "hub:primary",
      projectId: "prj_allowed01",
      runId: "run_allowed01",
      limit: 50,
    }));
  });

  it("rejects malformed queries and mismatched cursors before reading details", async () => {
    const querySource = source();
    const base = await start(querySource);
    const headers = { authorization: `Bearer ${token}` };

    const unknown = await fetch(`${base}/v1/trace/projects?unknown=1`, { headers });
    expect(unknown.status).toBe(400);
    const eventCursor = Buffer.from(JSON.stringify({ v: 1, kind: "event", seq: 1 }))
      .toString("base64url");
    const mismatched = await fetch(
      `${base}/v1/trace/projects/prj_allowed01?destinationId=hub%3Aprimary&cursor=${eventCursor}`,
      { headers },
    );
    expect(mismatched.status).toBe(400);
    expect(querySource.getProject).not.toHaveBeenCalled();
  });

  it("uses fixed route and method errors without querying trace data", async () => {
    const querySource = source();
    const base = await start(querySource);
    const missing = await fetch(`${base}/v1/trace/unknown`);
    expect(missing.status).toBe(404);
    const method = await fetch(`${base}/v1/trace/projects`, { method: "POST" });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
    expect(querySource.listProjects).not.toHaveBeenCalled();
  });

  it("replaces an oversized authorized result with a bounded safe error", async () => {
    const querySource = source();
    vi.mocked(querySource.listProjects).mockResolvedValue({
      items: [{ ...allowedProject, projectName: "가".repeat(2_000) }],
      nextCursor: null,
    });
    const base = await start(querySource, 1_024);
    const response = await fetch(`${base}/v1/trace/projects`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "response_too_large" } });
  });
});
