import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { SkillManifest } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  applySkillAuthorizationPlan,
  createSkillAuthorizationPlan,
  hashSkillPackage,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function candidate(): Promise<{ root: string; directory: string; manifest: SkillManifest }> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-skill-authorization-"));
  roots.push(root);
  const directory = resolve(root, ".agents/skills/release-check");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "SKILL.md"),
    "---\nname: release-check\ndescription: Run reviewed release checks.\n---\n\n# Checks\n",
  );
  const contentHash = await hashSkillPackage(directory);
  const manifest: SkillManifest = {
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
    requiredCapabilities: ["filesystem.read"],
    contracts: {
      inputSchemaRef: "lervo-schema://skill/input/v1",
      outputSchemaRef: "lervo-schema://skill/output/v1",
    },
    trust: { level: "untrusted", signatureStatus: "unsigned" },
    enabledScope: { kind: "disabled" },
    pinned: false,
  };
  await writeFile(resolve(directory, "lervo-skill.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, directory, manifest };
}

describe("project skill authorization", () => {
  it("binds exact candidate bytes and applies only reviewed project authority", async () => {
    const value = await candidate();
    const beforeContentHash = await hashSkillPackage(value.directory);
    const plan = await createSkillAuthorizationPlan({
      repositoryRoot: value.root,
      projectId: "prj_candidate01",
      skillId: value.manifest.skillId,
      reviewerId: "repository-maintainer",
      reviewedAt: "2026-09-05T02:00:00.000Z",
    });

    expect(plan).toMatchObject({
      status: "ready",
      skillId: "release-check",
      contentHash: beforeContentHash,
      trustTransition: { from: "untrusted", to: "reviewed" },
      scopeTransition: { from: "disabled", to: "project", projectId: "prj_candidate01" },
      desiredManifest: {
        trust: { level: "reviewed", reviewedBy: "repository-maintainer" },
        enabledScope: { kind: "projects", projectIds: ["prj_candidate01"] },
      },
    });
    const applied = await applySkillAuthorizationPlan({
      plan,
      approval: plan.planId,
      appliedAt: "2026-09-05T02:01:00.000Z",
    });
    expect(applied.status).toBe("applied");
    expect(await hashSkillPackage(value.directory)).toBe(beforeContentHash);
    expect(
      JSON.parse(await readFile(resolve(value.directory, "lervo-skill.json"), "utf8")),
    ).toMatchObject(plan.desiredManifest);
    expect(
      await applySkillAuthorizationPlan({
        plan,
        approval: plan.planId,
        appliedAt: "2026-09-05T02:02:00.000Z",
      }),
    ).toMatchObject({ status: "current" });
  });

  it("fails closed when reviewed manifest or content coordinates become stale", async () => {
    const manifestChanged = await candidate();
    const manifestPlan = await createSkillAuthorizationPlan({
      repositoryRoot: manifestChanged.root,
      projectId: "prj_candidate01",
      skillId: manifestChanged.manifest.skillId,
      reviewerId: "repository-maintainer",
      reviewedAt: "2026-09-05T02:00:00.000Z",
    });
    await writeFile(
      resolve(manifestChanged.directory, "lervo-skill.json"),
      `${JSON.stringify({ ...manifestChanged.manifest, pinned: true }, null, 2)}\n`,
    );
    await expect(
      applySkillAuthorizationPlan({
        plan: manifestPlan,
        approval: manifestPlan.planId,
        appliedAt: "2026-09-05T02:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "skill_authorization_stale" });

    const contentChanged = await candidate();
    const contentPlan = await createSkillAuthorizationPlan({
      repositoryRoot: contentChanged.root,
      projectId: "prj_candidate01",
      skillId: contentChanged.manifest.skillId,
      reviewerId: "repository-maintainer",
      reviewedAt: "2026-09-05T02:00:00.000Z",
    });
    await writeFile(resolve(contentChanged.directory, "SKILL.md"), "changed\n");
    await expect(
      applySkillAuthorizationPlan({
        plan: contentPlan,
        approval: contentPlan.planId,
        appliedAt: "2026-09-05T02:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "skill_authorization_stale" });
  });
});
