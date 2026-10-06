import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  HubKnowledgeConvergenceDefinitionClient,
  HubKnowledgeConvergenceHostClient,
  HubKnowledgeConvergenceOwnerUnavailableError,
} from "@lervo/sync";
import {
  calculateProjectIdentityHash,
  createKnowledgeConvergenceDefinition,
  syncContentHash,
} from "@lervo/sync-contract";
import { afterEach, expect, it } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";

const destinationId = "hub:convergence-definitions";
const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const syncToken = "hub-convergence-definitions-sync-aaaaaaaaaaaaaaaaa";
const otherProjectToken = "hub-convergence-definitions-other-cccccccccccccccc";
const project: ProjectManifest = {
  schemaVersion: 1,
  projectId: "prj_convergence_definitions_http",
  name: "convergence-definitions-http",
  root: ".",
  createdAt: "2026-10-06T00:00:00.000Z",
  dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
};
const identity = calculateProjectIdentityHash(project);
const wsl = `sha256:${"2".repeat(64)}`;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function hub(options: { definitions?: boolean } = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-hub-convergence-definitions-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await HubSyncSQLiteStore.open({ path: resolve(directory, "hub.sqlite") });
  const authenticator = new ConfiguredBearerAuthenticator([
    {
      token: syncToken,
      principalId: "node:convergence-definitions",
      permissions: ["sync.write"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
    {
      token: otherProjectToken,
      principalId: "node:other-project",
      permissions: ["sync.write"],
      projects: [{ destinationId, projectId: "prj_some_other_project" }],
    },
  ]);
  const server = createHubServer({
    trace: { authenticator, source: store },
    sync: { authenticator, store, hubIdentityHash },
  });
  if (options.definitions === false) {
    // An older Hub: the definitions route does not exist and answers like any unknown route.
    const listeners = server.listeners("request");
    server.removeAllListeners("request");
    server.on("request", (request, response) => {
      if (request.url?.includes("/knowledge-convergence-definitions")) {
        response.writeHead(404, {
          "content-type": "application/json",
          "x-lervo-hub-identity": hubIdentityHash,
        });
        response.end(JSON.stringify({ error: { code: "not_found" } }));
        return;
      }
      for (const listener of listeners)
        (listener as (...args: unknown[]) => void)(request, response);
    });
  }
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

const target = (baseUrl: string, bearerToken: string) => ({
  baseUrl,
  bearerToken,
  destinationId,
  hubIdentityHash,
  projectId: project.projectId,
  repositoryIdentityHash: identity,
});

const suite = {
  schemaVersion: 1,
  suiteId: "repository.knowledge",
  stopOnFailure: true,
  commands: [
    {
      commandId: "check",
      executable: "node",
      arguments: ["-e", "process.exit(0)"],
      cwd: ".",
      timeoutMs: 10000,
      maxOutputBytes: 16384,
      environmentVariableNames: [],
    },
  ],
};

function suiteDefinition(publishedAt: string) {
  return createKnowledgeConvergenceDefinition({
    projectId: project.projectId,
    repositoryIdentityHash: identity,
    kind: "verification_suite",
    bindingHash: syncContentHash(suite),
    content: suite,
    publishedAt,
    sourceHostHash: wsl,
  })!;
}

it("stores delegation-bound definitions content-addressed for a sync.write Node", async () => {
  const baseUrl = await hub();
  const definitions = new HubKnowledgeConvergenceHostClient(target(baseUrl, syncToken)).definitions;
  const definition = suiteDefinition("2026-10-06T01:00:00.000Z");
  expect(await definitions.read(definition.contentHash)).toBeNull();
  expect(await definitions.publish(definition)).toBe("created");
  expect(await definitions.publish(suiteDefinition("2026-10-06T02:00:00.000Z"))).toBe("refreshed");
  expect(await definitions.list()).toEqual([
    expect.objectContaining({
      kind: "verification_suite",
      bindingHash: definition.bindingHash,
      contentHash: definition.contentHash,
    }),
  ]);
  // The first stored bytes of a content hash are kept; a refresh changes only its time.
  expect(await definitions.read(definition.contentHash)).toEqual(definition);
});

it("refuses content that does not reproduce its binding and writes through the hash path", async () => {
  const baseUrl = await hub();
  const definition = suiteDefinition("2026-10-06T01:00:00.000Z");
  const forged = { ...definition, bindingHash: `sha256:${"7".repeat(64)}` };
  const definitions = new HubKnowledgeConvergenceDefinitionClient(target(baseUrl, syncToken));
  await expect(definitions.publish(forged)).rejects.toMatchObject({ httpStatus: 400 });
  const url = new URL(
    `v1/sync/projects/${project.projectId}/knowledge-convergence-definitions/${definition.contentHash}`,
    baseUrl,
  );
  url.searchParams.set("destinationId", destinationId);
  url.searchParams.set("projectIdentityHash", identity);
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${syncToken}`, "content-type": "application/json" },
    body: JSON.stringify(definition),
  });
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET");
});

it("keeps the project scope and names an older Hub by its 404", async () => {
  const baseUrl = await hub();
  const failure = await new HubKnowledgeConvergenceDefinitionClient(
    target(baseUrl, otherProjectToken),
  )
    .list()
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(HubKnowledgeConvergenceOwnerUnavailableError);
  expect(failure).toMatchObject({ failureCode: "hub_forbidden", httpStatus: 403 });

  const older = await hub({ definitions: false });
  const unsupported = await new HubKnowledgeConvergenceDefinitionClient(target(older, syncToken))
    .list()
    .catch((error: unknown) => error);
  expect(unsupported).toMatchObject({ httpStatus: 404 });
});
