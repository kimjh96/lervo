import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import type { CapabilityPackageManifest } from "@lervo/schemas";

import {
  capabilityRoot,
  capabilityPublicationStructure,
  applyCapabilityMigration,
  createCapabilityMigrationPlan,
  decodeCapabilityPackage,
  discoverCapabilityRoot,
  encodeCapabilityPackage,
  FileSystemCapabilityRegistry,
  createCapabilityActivationRequests,
  hashCapabilityFiles,
  installCapabilityPackage,
  recommendCapabilities,
  readCapabilityPackage,
  resolveCapabilities,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "lervo-capability-"));
  roots.push(value);
  return value;
}

async function packageAt(
  base: string,
  source: CapabilityPackageManifest["source"]["kind"] = "external",
): Promise<string> {
  await mkdir(base, { recursive: true });
  const payload = new TextEncoder().encode('{"type":"object"}\n');
  const runtime = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      serverName: "research-web-search",
      transport: {
        kind: "stdio",
        command: "node",
        entrypointPath: "server.mjs",
        arguments: [],
        timeoutMs: 5000,
      },
    }),
  );
  const server = new TextEncoder().encode("process.stdin.resume();\n");
  await writeFile(resolve(base, "configuration.schema.json"), payload);
  await writeFile(resolve(base, "lervo-mcp.json"), runtime);
  await writeFile(resolve(base, "server.mjs"), server);
  const contentHash = hashCapabilityFiles([
    { path: "configuration.schema.json", bytes: payload },
    { path: "lervo-mcp.json", bytes: runtime },
    { path: "server.mjs", bytes: server },
  ]);
  const manifest: CapabilityPackageManifest = {
    schemaVersion: 1,
    capabilityId: "research/web-search",
    kind: "mcp_server",
    version: "1.2.0",
    contentHash,
    source: {
      kind: source,
      uri: "https://example.invalid/research",
      publisher: { id: "publisher_example", name: "Example" },
    },
    compatibility: {
      providers: { mode: "any" },
      minimumRuntimeVersion: "0.1.0",
      platforms: ["darwin", "linux", "win32"],
    },
    requiredPermissions: ["network.access"],
    dependencies: [],
    entrypoint: {
      kind: "mcp_server",
      adapterId: "mcp.stdio",
      configurationSchemaRef: "configuration.schema.json",
      runtimeDescriptorPath: "lervo-mcp.json",
      credentialNames: ["SEARCH_TOKEN"],
    },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  await writeFile(resolve(base, "lervo-capability.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return base;
}

it("resolves the default user capability root from the operating-system home", () => {
  const originalHome = process.env.HOME;
  const originalCapabilityRoot = process.env.LERVO_USER_CAPABILITY_ROOT;
  try {
    delete process.env.HOME;
    delete process.env.LERVO_USER_CAPABILITY_ROOT;
    expect(capabilityRoot("repository", "user")).toBe(
      resolve(homedir(), ".lervo/capabilities/packages"),
    );
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalCapabilityRoot === undefined) delete process.env.LERVO_USER_CAPABILITY_ROOT;
    else process.env.LERVO_USER_CAPABILITY_ROOT = originalCapabilityRoot;
  }
});

it("verifies, envelopes, installs, and resolves an immutable local capability", async () => {
  const repositoryRoot = await root();
  const source = await packageAt(resolve(await root(), "package"));
  const verified = await readCapabilityPackage(source);
  expect(decodeCapabilityPackage(encodeCapabilityPackage(verified)).manifest).toEqual(
    verified.manifest,
  );
  await installCapabilityPackage({ repositoryRoot, scope: "project", package: verified });
  const discovered = await discoverCapabilityRoot(
    capabilityRoot(repositoryRoot, "project"),
    "project",
  );
  expect(discovered).toHaveLength(1);
  const result = await resolveCapabilities({
    repositoryRoot,
    projectId: "prj_0123456789abcdef01234567",
    capabilityIds: ["research/web-search"],
    provider: "codex",
    platform: "darwin",
    generatedAt: "2026-08-25T00:00:00.000Z",
    userRoot: resolve(repositoryRoot, "user"),
  });
  expect(result.selected[0]).toMatchObject({
    capabilityId: "research/web-search",
    kind: "mcp_server",
    sourceKind: "project",
    activationStatus: "resolved",
  });
  expect(createCapabilityActivationRequests(result.activationPackages)).toEqual([
    expect.objectContaining({
      capabilityId: "research/web-search",
      runtime: expect.objectContaining({
        kind: "mcp_stdio",
        serverName: "research-web-search",
        command: "node",
        credentialNames: ["SEARCH_TOKEN"],
      }),
    }),
  ]);
});

it("migrates a loose project skill and recommends it from declared natural-language intent", async () => {
  const repositoryRoot = await root();
  const skillRoot = resolve(repositoryRoot, ".agents/skills/research-competitors");
  await mkdir(skillRoot, { recursive: true });
  const content =
    "---\nname: research/competitors\ndescription: Research competing products and summarize evidence\n---\n# Competitor research\nUse primary sources.\n";
  await writeFile(resolve(skillRoot, "SKILL.md"), content);

  const plan = await createCapabilityMigrationPlan(repositoryRoot);
  expect(plan).toMatchObject({
    status: "ready",
    items: [{ capabilityId: "research/competitors", action: "create" }],
  });
  expect(await applyCapabilityMigration(plan)).toMatchObject({ status: "current" });
  const installed = await readCapabilityPackage(
    resolve(capabilityRoot(repositoryRoot, "project"), "research%2Fcompetitors@1.0.0"),
  );
  const migratedSkill = JSON.parse(
    new TextDecoder().decode(
      installed.files.find((file) => file.path === "lervo-skill.json")?.bytes,
    ),
  );
  expect(migratedSkill).toMatchObject({
    skillId: "research/competitors",
    supportedRoles: ["*"],
    trust: { level: "untrusted" },
  });
  const recommended = await recommendCapabilities({
    repositoryRoot,
    query: "Research competing products and summarize evidence",
    provider: "codex",
    platform: process.platform,
    userRoot: resolve(repositoryRoot, "user"),
  });
  expect(recommended).toEqual([
    expect.objectContaining({
      capabilityId: "research/competitors",
      score: expect.any(Number),
      reasonCodes: expect.arrayContaining(["intent_phrase"]),
    }),
  ]);
});

it("bounds a long portable skill description independently for discovery intent", async () => {
  const repositoryRoot = await root();
  const skillRoot = resolve(repositoryRoot, ".agents/skills/checkup");
  await mkdir(skillRoot, { recursive: true });
  const description =
    "Check the project status — measure the live box and, if a milestone has been reached, do that work immediately. Use this skill when the user asks anything of the kind 현황, 얼마나 됐나, 진행 상황, 이상 무, 확인해줘 (status, how far along, progress, all clear, check for me).";
  expect([...description].length).toBeGreaterThan(200);
  await writeFile(
    resolve(skillRoot, "SKILL.md"),
    `---\nname: checkup\ndescription: ${description}\n---\n# Checkup\nMeasure current status.\n`,
  );

  const plan = await createCapabilityMigrationPlan(repositoryRoot);
  expect(plan).toMatchObject({
    status: "ready",
    items: [{ capabilityId: "checkup", action: "create" }],
  });
  await applyCapabilityMigration(plan);
  const installed = await readCapabilityPackage(
    resolve(capabilityRoot(repositoryRoot, "project"), "checkup@1.0.0"),
  );
  expect(installed.manifest.discovery).toMatchObject({
    summary: description,
    intents: [[...description].slice(0, 200).join("")],
  });
});

it("rejects conventional secret material before installation or publication", async () => {
  const source = await packageAt(resolve(await root(), "package"));
  await writeFile(resolve(source, ".env"), "TOKEN=do-not-publish\n");
  await expect(readCapabilityPackage(source)).rejects.toMatchObject({
    code: "capability_unsafe_package",
  });
});

it("publishes one immutable filesystem record under concurrent same-content retries", async () => {
  const source = await packageAt(resolve(await root(), "package"));
  const verified = await readCapabilityPackage(source);
  const registry = new FileSystemCapabilityRegistry(resolve(await root(), "registry"));
  const packageValue = encodeCapabilityPackage(verified);
  const value = {
    schemaVersion: 1 as const,
    scope: { kind: "public" as const },
    publisherPrincipalId: "node_test",
    publishedAt: "2026-08-25T00:00:00.000Z",
    structure: capabilityPublicationStructure(packageValue),
    package: packageValue,
  };
  const results = await Promise.all([registry.put(value), registry.put(value)]);
  expect(results.sort()).toEqual(["created", "present"]);
  expect(
    (await registry.get(value.scope, verified.manifest.capabilityId, verified.manifest.version))
      ?.package.manifest.contentHash,
  ).toBe(verified.manifest.contentHash);
});
