import { type AddressInfo } from "node:net";

import {
  type HubProjectTraceSummary,
  type HubTraceSource,
} from "@lervo/hub-trace";
import { vi } from "vitest";

import {
  ConfiguredBearerAuthenticator,
  createHubTraceServer,
  type HubBearerCredential,
  type HubRequestAuthenticator,
} from "../src/index.js";

export const token = "lervo-http-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const allowedProject: HubProjectTraceSummary = {
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
export const secondProject: HubProjectTraceSummary = {
  ...allowedProject,
  projectId: "prj_allowed02",
  projectName: "두 번째 project",
};
export const credentials: HubBearerCredential[] = [{
  token,
  principalId: "operator:http-test",
  permissions: ["trace.read", "policy.read", "policy.write"],
  projects: [
    { destinationId: allowedProject.destinationId, projectId: allowedProject.projectId },
    { destinationId: secondProject.destinationId, projectId: secondProject.projectId },
  ],
}];

const openServers: ReturnType<typeof createHubTraceServer>[] = [];

export function traceSource(): HubTraceSource {
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
    getKnowledgeGraph: vi.fn(async () => null),
  };
}

export async function startHubTestServer(
  querySource: HubTraceSource,
  maxResponseBytes?: number,
  authenticator: HubRequestAuthenticator = new ConfiguredBearerAuthenticator(credentials),
): Promise<string> {
  const server = createHubTraceServer({
    authenticator,
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

export async function closeHubTestServers(): Promise<void> {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  })));
}
