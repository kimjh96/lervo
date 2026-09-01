import { once } from "node:events";

import { afterEach, expect, it } from "vitest";

import { hashCapabilityFiles, MemoryCapabilityRegistry } from "@lervo/capabilities";
import type { CapabilityPackageManifest } from "@lervo/schemas";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";

const servers: ReturnType<typeof createHubServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.close();
      await once(server, "close");
    }),
  );
});

function envelope() {
  const payload = new TextEncoder().encode(
    JSON.stringify({ name: "shared-research", version: "1.0.0" }),
  );
  const manifest: CapabilityPackageManifest = {
    schemaVersion: 1,
    capabilityId: "shared/research",
    kind: "provider_plugin",
    version: "1.0.0",
    contentHash: hashCapabilityFiles([{ path: ".codex-plugin/plugin.json", bytes: payload }]),
    source: {
      kind: "external",
      uri: "https://example.invalid/plugin",
      publisher: { id: "publisher_example", name: "Example" },
    },
    compatibility: {
      providers: { mode: "allowlist", providers: ["codex"] },
      minimumRuntimeVersion: "0.1.0",
      platforms: ["darwin", "linux", "win32"],
    },
    requiredPermissions: [],
    dependencies: [],
    entrypoint: {
      kind: "provider_plugin",
      provider: "codex",
      pluginManifestPath: ".codex-plugin/plugin.json",
    },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  return {
    schemaVersion: 1 as const,
    manifest,
    files: [
      { path: ".codex-plugin/plugin.json", contentBase64: Buffer.from(payload).toString("base64") },
    ],
  };
}

async function fixture(permissions: Array<"capability.read" | "capability.publish">) {
  const token = "t".repeat(40);
  const authenticator = new ConfiguredBearerAuthenticator([
    {
      token,
      principalId: "node_capability_test",
      permissions,
      projects: [{ destinationId: "dest_test", projectId: "prj_0123456789abcdef01234567" }],
    },
  ]);
  const server = createHubServer({
    trace: {
      authenticator,
      source: {
        listProjects: async () => ({ items: [], nextCursor: null }),
        getProject: async () => null,
        getRun: async () => null,
        getWork: async () => null,
        getKnowledgeGraph: async () => null,
      },
    },
    capabilities: {
      authenticator,
      registry: new MemoryCapabilityRegistry(),
      hubIdentityHash: `sha256:${"a".repeat(64)}`,
    },
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing address");
  return { token, base: `http://127.0.0.1:${address.port}` };
}

it("publishes and reads an exact project-scoped capability package", async () => {
  const { token, base } = await fixture(["capability.read", "capability.publish"]);
  const scope = {
    kind: "project",
    destinationId: "dest_test",
    projectId: "prj_0123456789abcdef01234567",
  };
  const published = await fetch(`${base}/v1/capabilities/package`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, scope, package: envelope() }),
  });
  expect(published.status).toBe(201);
  const read = await fetch(
    `${base}/v1/capabilities/package?scope=project&destinationId=dest_test&projectId=prj_0123456789abcdef01234567&capabilityId=shared%2Fresearch&version=1.0.0`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(read.status).toBe(200);
  const record = (await read.json()) as {
    structure: {
      contentClass: string;
      capabilityKind: string;
      fileCount: number;
      secretMaterial: string;
    };
    package: { manifest: { contentHash: string } };
  };
  expect(record.package.manifest.contentHash).toBe(envelope().manifest.contentHash);
  expect(record.structure).toMatchObject({
    contentClass: "capability_package",
    capabilityKind: "provider_plugin",
    fileCount: 1,
    secretMaterial: "excluded",
  });
});

it("denies publication when the credential has only read permission", async () => {
  const { token, base } = await fixture(["capability.read"]);
  const response = await fetch(`${base}/v1/capabilities/package`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, scope: { kind: "public" }, package: envelope() }),
  });
  expect(response.status).toBe(403);
});
