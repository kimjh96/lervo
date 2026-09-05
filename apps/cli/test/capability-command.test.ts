import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { hashCapabilityFiles } from "@lervo/capabilities";
import { createDefaultManifest, serializeYaml } from "@lervo/project";
import type { CapabilityPackageManifest } from "@lervo/schemas";
import { hashSkillPackage } from "@lervo/skills";

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

it("shows skill authorization help without requiring a project", async () => {
  const output = io("/");

  expect(await runCapabilityCommand(["authorize-skill", "--help"], output.io)).toBe(0);
  expect(output.out.join("")).toContain(
    "lervo capability authorize-skill --skill <skill-id> --reviewer <id>",
  );
});

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

it("authorizes an exact promoted skill through a saved CLI plan", async () => {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), "lervo-skill-authorization-cli-"));
  roots.push(repositoryRoot);
  await mkdir(resolve(repositoryRoot, ".lervo"), { recursive: true });
  const project = createDefaultManifest(
    {
      root: repositoryRoot,
      name: "authorization-cli",
      projectId: "prj_authorize01",
      now: new Date("2026-09-05T00:00:00.000Z"),
    },
    repositoryRoot,
  );
  await writeFile(resolve(repositoryRoot, ".lervo/project.yaml"), serializeYaml(project));
  const skillRoot = resolve(repositoryRoot, ".agents/skills/release-check");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    resolve(skillRoot, "SKILL.md"),
    "---\nname: release-check\ndescription: Run reviewed release checks.\n---\n# Checks\n",
  );
  const contentHash = await hashSkillPackage(skillRoot);
  await writeFile(
    resolve(skillRoot, "lervo-skill.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        skillId: "release-check",
        version: "1.0.0",
        contentHash,
        source: {
          kind: "project",
          uri: ".agents/skills/release-check",
          publisher: {
            id: "lervo.development-pattern",
            name: "Lervo development-pattern review",
          },
        },
        supportedRoles: ["developer"],
        compatibility: {
          providers: { mode: "any" },
          minimumRuntimeVersion: "0.11.4",
          platforms: ["darwin", "linux", "win32"],
          requiredTools: [],
          unknownIsCompatible: false,
        },
        requiredCapabilities: [],
        contracts: {
          inputSchemaRef: "lervo-schema://skill/input/v1",
          outputSchemaRef: "lervo-schema://skill/output/v1",
        },
        trust: { level: "untrusted", signatureStatus: "unsigned" },
        enabledScope: { kind: "disabled" },
        pinned: false,
      },
      null,
      2,
    )}\n`,
  );

  const planned = io(repositoryRoot);
  expect(
    await runCapabilityCommand(
      [
        "authorize-skill",
        "--skill",
        "release-check",
        "--reviewer",
        "repository-maintainer",
        "--json",
      ],
      planned.io,
    ),
  ).toBe(0);
  const plan = JSON.parse(planned.out.join("")) as { planId: string };
  await writeFile(resolve(repositoryRoot, "authorization-plan.json"), planned.out.join(""));
  const applied = io(repositoryRoot);
  expect(
    await runCapabilityCommand(
      [
        "authorize-skill",
        "--from",
        "authorization-plan.json",
        "--apply",
        "--approval",
        plan.planId,
        "--json",
      ],
      applied.io,
    ),
  ).toBe(0);
  expect(JSON.parse(applied.out.join(""))).toMatchObject({
    operation: "project_skill_authorized",
    status: "applied",
  });
  expect(JSON.parse(await readFile(resolve(skillRoot, "lervo-skill.json"), "utf8"))).toMatchObject({
    trust: { level: "reviewed", reviewedBy: "repository-maintainer" },
    enabledScope: { kind: "projects", projectIds: ["prj_authorize01"] },
  });
});
