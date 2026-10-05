import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  HubKnowledgeInstructionCandidateClient,
  HubKnowledgeInstructionCandidateUnavailableError,
} from "@lervo/sync";
import {
  calculateProjectIdentityHash,
  knowledgeInstructionCandidateHash,
  type KnowledgeInstructionCandidateRecord,
} from "@lervo/sync-contract";
import { afterEach, expect, it } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";

const destinationId = "hub:instruction-candidates";
const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const coordinateToken = "hub-instruction-candidates-token-aaaaaaaaaaaaaaaa";
const readOnlyToken = "hub-instruction-candidates-read-bbbbbbbbbbbbbbbbbb";
const project: ProjectManifest = {
  schemaVersion: 1,
  projectId: "prj_instruction_candidates_http",
  name: "instruction-candidates-http",
  root: ".",
  createdAt: "2026-10-05T00:00:00.000Z",
  dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
};
const identity = calculateProjectIdentityHash(project);
const mac = `sha256:${"1".repeat(64)}`;
const wsl = `sha256:${"2".repeat(64)}`;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function hub() {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-hub-instruction-candidates-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await HubSyncSQLiteStore.open({ path: resolve(directory, "hub.sqlite") });
  const authenticator = new ConfiguredBearerAuthenticator([
    {
      token: coordinateToken,
      principalId: "node:instruction-candidates",
      permissions: ["workspace.read", "workspace.coordinate"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
    {
      token: readOnlyToken,
      principalId: "node:instruction-candidates-read",
      permissions: ["workspace.read"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
  ]);
  const server = createHubServer({
    trace: { authenticator, source: store },
    sync: { authenticator, store, hubIdentityHash },
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  cleanups.push(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await store.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

function client(baseUrl: string, token = coordinateToken) {
  return new HubKnowledgeInstructionCandidateClient({
    baseUrl,
    bearerToken: token,
    destinationId,
    hubIdentityHash,
    projectId: project.projectId,
    repositoryIdentityHash: identity,
  });
}

function record(
  sourceHostHash: string,
  resolution: KnowledgeInstructionCandidateRecord["resolution"] = "open",
): KnowledgeInstructionCandidateRecord {
  const candidate = {
    schemaVersion: 1,
    candidateId: `kinstruction_${"c".repeat(24)}`,
    projectId: project.projectId,
    proposedContentHash: `sha256:${"d".repeat(64)}`,
    proposedMarkdown: "# Keep both hosts available\n\nNormalized rule text.\n",
  };
  return {
    schemaVersion: 1,
    projectId: project.projectId,
    repositoryIdentityHash: identity,
    proposedContentHash: candidate.proposedContentHash,
    candidateHash: knowledgeInstructionCandidateHash(candidate),
    candidate,
    sourceHostHash,
    resolution,
    resolvedByHostHash: resolution === "open" ? null : sourceHostHash,
    publishedAt: "2026-10-05T01:00:00.000Z",
    resolvedAt: resolution === "open" ? null : "2026-10-05T02:00:00.000Z",
  };
}

it("stores one record per rule across hosts and lets a resolution win", async () => {
  const baseUrl = await hub();
  expect(await client(baseUrl).publish(record(mac))).toBe("created");
  expect(await client(baseUrl).publish(record(wsl))).toBe("duplicate");
  expect(await client(baseUrl).list()).toEqual([record(mac)]);
  expect(await client(baseUrl).publish(record(wsl, "applied"))).toBe("updated");
  expect(await client(baseUrl).publish(record(mac))).toBe("duplicate");
  expect(await client(baseUrl).list()).toMatchObject([
    { resolution: "applied", resolvedByHostHash: wsl, sourceHostHash: mac },
  ]);
});

it("requires coordinate permission to publish and rejects an altered candidate", async () => {
  const baseUrl = await hub();
  await expect(client(baseUrl, readOnlyToken).publish(record(mac))).rejects.toBeInstanceOf(
    HubKnowledgeInstructionCandidateUnavailableError,
  );
  expect(await client(baseUrl, readOnlyToken).list()).toEqual([]);
  const altered = { ...record(mac), candidateHash: `sha256:${"e".repeat(64)}` };
  await expect(client(baseUrl).publish(altered)).rejects.toBeInstanceOf(
    HubKnowledgeInstructionCandidateUnavailableError,
  );
});
