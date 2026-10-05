import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  HubKnowledgeConvergenceOwnerClient,
  HubKnowledgeConvergenceOwnerUnavailableError,
} from "@lervo/sync";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, expect, it } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";

const destinationId = "hub:convergence-owner";
const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const coordinateToken = "hub-convergence-owner-token-aaaaaaaaaaaaaaaaaaaa";
const traceOnlyToken = "hub-convergence-trace-only-bbbbbbbbbbbbbbbbbbbbb";
const project: ProjectManifest = {
  schemaVersion: 1,
  projectId: "prj_convergence_owner_http",
  name: "convergence-owner-http",
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

async function hub(path: string, clock: { now: number }) {
  const store = await HubSyncSQLiteStore.open({ path });
  const authenticator = new ConfiguredBearerAuthenticator([
    {
      token: coordinateToken,
      principalId: "node:convergence-owner",
      permissions: ["workspace.read", "workspace.coordinate"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
    {
      token: traceOnlyToken,
      principalId: "operator:trace-only",
      permissions: ["trace.read"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
  ]);
  const server = createHubServer({
    trace: { authenticator, source: store },
    sync: { authenticator, store, hubIdentityHash, now: () => new Date(clock.now) },
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const close = async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await store.close();
  };
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close };
}

function client(baseUrl: string, token = coordinateToken, expected = hubIdentityHash) {
  return new HubKnowledgeConvergenceOwnerClient({
    baseUrl,
    bearerToken: token,
    destinationId,
    hubIdentityHash: expected,
    projectId: project.projectId,
    repositoryIdentityHash: identity,
  });
}

const claim = (hostHash: string, hostLabel: string) => ({
  operation: "claim" as const,
  request: {
    schemaVersion: 1 as const,
    projectId: project.projectId,
    repositoryIdentityHash: identity,
    hostHash,
    hostLabel,
    ttlMs: 30 * 60_000,
  },
});

it("serializes the convergence owner lease through the Hub and keeps it across restarts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hub-convergence-owner-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const clock = { now: Date.parse("2026-10-05T00:00:00.000Z") };
  const path = resolve(root, "hub.sqlite");
  let running = await hub(path, clock);

  const granted = await client(running.baseUrl).mutate(claim(mac, "mac"));
  expect(granted).toMatchObject({
    status: "granted",
    predecessor: null,
    lease: { holderHostHash: mac, holderLabel: "mac", generation: 1 },
  });
  await expect(client(running.baseUrl).mutate(claim(wsl, "wsl"))).resolves.toMatchObject({
    status: "held_elsewhere",
    lease: { holderLabel: "mac" },
  });
  await expect(client(running.baseUrl).read()).resolves.toMatchObject({
    status: "held",
    lease: { holderLabel: "mac" },
  });

  // A Hub restart keeps the lease; expiry is measured on the Hub clock.
  await running.close();
  running = await hub(path, clock);
  cleanups.push(() => running.close());
  await expect(client(running.baseUrl).mutate(claim(wsl, "wsl"))).resolves.toMatchObject({
    status: "held_elsewhere",
  });
  clock.now += 30 * 60_000;
  await expect(client(running.baseUrl).mutate(claim(wsl, "wsl"))).resolves.toMatchObject({
    status: "granted",
    predecessor: { holderHostHash: mac, generation: 1, ended: "expired" },
    lease: { holderLabel: "wsl", generation: 2 },
  });
  await expect(
    client(running.baseUrl).mutate({
      operation: "release",
      request: {
        schemaVersion: 1,
        projectId: project.projectId,
        repositoryIdentityHash: identity,
        hostHash: mac,
        generation: 1,
      },
    }),
  ).resolves.toMatchObject({ status: "not_holder" });
});

it("refuses principals without coordination permission and unverified Hub identities", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hub-convergence-owner-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const running = await hub(resolve(root, "hub.sqlite"), { now: Date.now() });
  cleanups.push(() => running.close());
  // Each refusal carries the cause an unverifiable verdict reports, never only "unavailable".
  await expect(
    client(running.baseUrl, traceOnlyToken).mutate(claim(mac, "mac")),
  ).rejects.toMatchObject({ failureCode: "hub_forbidden", httpStatus: 403 });
  await expect(
    client(running.baseUrl, "hub-convergence-unknown-token-ccccccccccccccccccc").mutate(
      claim(mac, "mac"),
    ),
  ).rejects.toMatchObject({ failureCode: "hub_unauthorized", httpStatus: 401 });
  await expect(
    client(running.baseUrl, coordinateToken, `sha256:${"8".repeat(64)}`).mutate(claim(mac, "mac")),
  ).rejects.toBeInstanceOf(HubKnowledgeConvergenceOwnerUnavailableError);
  await expect(
    client(running.baseUrl, coordinateToken, `sha256:${"8".repeat(64)}`).mutate(claim(mac, "mac")),
  ).rejects.toMatchObject({ failureCode: "hub_identity_mismatch", httpStatus: null });

  const url = new URL(
    `v1/sync/projects/${project.projectId}/knowledge-convergence-owner`,
    running.baseUrl,
  );
  url.searchParams.set("destinationId", destinationId);
  url.searchParams.set("projectIdentityHash", identity);
  const invalid = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${coordinateToken}`, "content-type": "application/json" },
    body: JSON.stringify({ ...claim(mac, "Mac Host"), extra: true }),
  });
  expect(invalid.status).toBe(400);
});
