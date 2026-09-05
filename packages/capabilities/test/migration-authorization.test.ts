import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { CapabilityPackageManifest, SkillManifest } from "@lervo/schemas";
import { afterEach, expect, it } from "vitest";

import {
  applyCapabilityMigration,
  capabilityRoot,
  createCapabilityMigrationPlan,
  hashCapabilityFiles,
  installCapabilityPackage,
  readCapabilityPackage,
} from "../src/index.js";

const roots: string[] = [];
const platform =
  process.platform === "darwin" || process.platform === "linux" || process.platform === "win32"
    ? process.platform
    : "linux";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function promotedPackage(trust: "untrusted" | "reviewed" = "reviewed") {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), "lervo-promoted-migration-"));
  roots.push(repositoryRoot);
  const skillRoot = resolve(repositoryRoot, ".agents/skills/release-check");
  await mkdir(skillRoot, { recursive: true });
  const instructions = new TextEncoder().encode(
    "---\nname: release-check\ndescription: Run reviewed release checks.\n---\n# Checks\n",
  );
  await writeFile(resolve(skillRoot, "SKILL.md"), instructions);
  const contentHash = hashCapabilityFiles([{ path: "SKILL.md", bytes: instructions }]);
  const source = {
    kind: "project" as const,
    uri: ".agents/skills/release-check",
    publisher: {
      id: "lervo.development-pattern",
      name: "Lervo development-pattern review",
    },
  };
  const skill: SkillManifest = {
    schemaVersion: 1,
    skillId: "release-check",
    version: "1.0.0",
    contentHash,
    source,
    supportedRoles: ["developer"],
    compatibility: {
      providers: { mode: "allowlist", providers: ["codex"] },
      minimumRuntimeVersion: "0.11.4",
      platforms: [platform],
      requiredTools: [],
      unknownIsCompatible: false,
    },
    requiredCapabilities: ["filesystem.read"],
    contracts: {
      inputSchemaRef: "lervo-schema://skill/input/v1",
      outputSchemaRef: "lervo-schema://skill/output/v1",
    },
    trust:
      trust === "reviewed"
        ? {
            level: "reviewed",
            signatureStatus: "unsigned",
            reviewedBy: "repository-maintainer",
            reviewedAt: "2026-09-05T02:00:00.000Z",
          }
        : { level: "untrusted", signatureStatus: "unsigned" },
    enabledScope:
      trust === "reviewed"
        ? { kind: "projects", projectIds: ["prj_candidate01"] }
        : { kind: "disabled" },
    pinned: false,
  };
  const dependency = {
    capabilityId: "repository/review_mcp",
    version: "1.0.0",
    contentHash: `sha256:${"a".repeat(64)}`,
  };
  const capability: CapabilityPackageManifest = {
    schemaVersion: 1,
    capabilityId: "repository/release_check",
    kind: "skill",
    version: "1.0.0",
    contentHash,
    source,
    compatibility: {
      providers: { mode: "allowlist", providers: ["codex"] },
      minimumRuntimeVersion: "0.11.4",
      platforms: [platform],
    },
    requiredPermissions: ["filesystem.read"],
    dependencies: [dependency],
    entrypoint: { kind: "skill", skillId: "release-check", manifestPath: "lervo-skill.json" },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  await Promise.all([
    writeFile(resolve(skillRoot, "lervo-skill.json"), `${JSON.stringify(skill, null, 2)}\n`),
    writeFile(
      resolve(skillRoot, "lervo-capability.json"),
      `${JSON.stringify(capability, null, 2)}\n`,
    ),
  ]);
  return { repositoryRoot, skillRoot, capability, dependency, contentHash };
}

it("preserves an authorized promoted contract and its exact dependencies", async () => {
  const value = await promotedPackage();
  const plan = await createCapabilityMigrationPlan(value.repositoryRoot);
  expect(plan.items).toEqual([
    expect.objectContaining({
      capabilityId: value.capability.capabilityId,
      contentHash: value.contentHash,
      packageHash: expect.stringMatching(/^sha256:/u),
    }),
  ]);
  await applyCapabilityMigration(plan);
  const migrated = await readCapabilityPackage(
    resolve(capabilityRoot(value.repositoryRoot, "project"), "repository%2Frelease_check@1.0.0"),
  );
  expect(migrated.manifest.dependencies).toEqual([value.dependency]);
  expect(migrated.manifest.capabilityId).toBe(value.capability.capabilityId);
});

it("blocks unreviewed promoted packages and stale manifest-only migration plans", async () => {
  const unauthorized = await promotedPackage("untrusted");
  await expect(createCapabilityMigrationPlan(unauthorized.repositoryRoot)).rejects.toThrow(
    /requires exact project authorization/u,
  );

  const stale = await promotedPackage();
  const plan = await createCapabilityMigrationPlan(stale.repositoryRoot);
  await writeFile(
    resolve(stale.skillRoot, "lervo-capability.json"),
    `${JSON.stringify(
      {
        ...stale.capability,
        discovery: {
          displayName: "Changed after planning",
          summary: "Changed after the exact migration plan was reviewed.",
          keywords: ["changed"],
          intents: ["Changed after planning"],
          autoSelect: false,
        },
      },
      null,
      2,
    )}\n`,
  );
  await expect(applyCapabilityMigration(plan)).rejects.toMatchObject({
    code: "capability_approval_mismatch",
  });
});

it("treats manifest-only changes as immutable package conflicts", async () => {
  const first = await promotedPackage();
  const source = await readCapabilityPackage(first.skillRoot);
  await installCapabilityPackage({
    repositoryRoot: first.repositoryRoot,
    scope: "project",
    package: source,
  });
  await writeFile(
    resolve(first.skillRoot, "lervo-capability.json"),
    `${JSON.stringify({ ...first.capability, dependencies: [] }, null, 2)}\n`,
  );
  await expect(
    installCapabilityPackage({
      repositoryRoot: first.repositoryRoot,
      scope: "project",
      package: await readCapabilityPackage(first.skillRoot),
    }),
  ).rejects.toMatchObject({ code: "capability_conflict" });
});
