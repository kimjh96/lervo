import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { hashCapabilityFiles } from "@lervo/capabilities";
import type { CapabilityPackageManifest } from "@lervo/schemas";

import { runCapabilityCommand } from "../src/capability-command.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), "lervo-capability-cli-"));
  roots.push(repositoryRoot);
  const source = resolve(repositoryRoot, "source");
  await mkdir(source);
  const payload = new TextEncoder().encode("{}\n");
  await writeFile(resolve(source, "config.schema.json"), payload);
  const runtime = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      serverName: "tools-local-mcp",
      transport: {
        kind: "stdio",
        command: "node",
        entrypointPath: "server.mjs",
        arguments: [],
        timeoutMs: 5000,
      },
    }),
  );
  await writeFile(resolve(source, "lervo-mcp.json"), runtime);
  const server = new TextEncoder().encode("process.stdin.resume();\n");
  await writeFile(resolve(source, "server.mjs"), server);
  const manifest: CapabilityPackageManifest = {
    schemaVersion: 1,
    capabilityId: "tools/local-mcp",
    kind: "mcp_server",
    version: "1.0.0",
    contentHash: hashCapabilityFiles([
      { path: "config.schema.json", bytes: payload },
      { path: "lervo-mcp.json", bytes: runtime },
      { path: "server.mjs", bytes: server },
    ]),
    source: {
      kind: "external",
      uri: "https://example.invalid/mcp",
      publisher: { id: "publisher_example", name: "Example" },
    },
    compatibility: {
      providers: { mode: "any" },
      minimumRuntimeVersion: "0.1.0",
      platforms: ["darwin", "linux", "win32"],
    },
    requiredPermissions: [],
    dependencies: [],
    entrypoint: {
      kind: "mcp_server",
      adapterId: "mcp.local",
      configurationSchemaRef: "config.schema.json",
      runtimeDescriptorPath: "lervo-mcp.json",
      credentialNames: [],
    },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  await writeFile(
    resolve(source, "lervo-capability.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { repositoryRoot, source };
}

function io(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      cwd,
      stdout: (value: string) => out.push(value),
      stderr: (value: string) => err.push(value),
    },
    out,
    err,
  };
}

it("plans before applying an immutable project capability installation", async () => {
  const value = await fixture();
  const first = io(value.repositoryRoot);
  expect(
    await runCapabilityCommand(
      ["install", "--from", value.source, "--scope", "project", "--json"],
      first.io,
    ),
  ).toBe(0);
  const plan = JSON.parse(first.out.join("")) as { planHash: string };
  const applied = io(value.repositoryRoot);
  expect(
    await runCapabilityCommand(
      [
        "install",
        "--from",
        value.source,
        "--scope",
        "project",
        "--apply",
        "--approval",
        plan.planHash,
        "--json",
      ],
      applied.io,
    ),
  ).toBe(0);
  const listed = io(value.repositoryRoot);
  expect(await runCapabilityCommand(["list", "--scope", "project", "--json"], listed.io)).toBe(0);
  expect(JSON.parse(listed.out.join("")).packages[0]).toMatchObject({
    capabilityId: "tools/local-mcp",
    scope: "project",
    version: "1.0.0",
  });
});

it("rejects apply when approval does not match the current package", async () => {
  const value = await fixture();
  const output = io(value.repositoryRoot);
  expect(
    await runCapabilityCommand(
      [
        "install",
        "--from",
        value.source,
        "--scope",
        "project",
        "--apply",
        "--approval",
        `sha256:${"0".repeat(64)}`,
      ],
      output.io,
    ),
  ).toBe(1);
  expect(output.err.join("")).toContain("current install plan hash");
});
