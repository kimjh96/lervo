import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { SkillManifest } from "@lervo/schemas";
import { hashSkillPackage } from "@lervo/skills";
import { afterEach, describe, expect, it } from "vitest";

import { defaultRepositoryKnowledgePolicy } from "../src/policy.js";
import { scanRepositoryKnowledge } from "../src/scanner.js";
import { SKILL_CONTRACT_SOURCE_UNIT_ADAPTER } from "../src/skill-contract-source-units.js";

const roots: string[] = [];

async function fixture(): Promise<{ root: string; directory: string; manifest: SkillManifest }> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-skill-contract-source-"));
  roots.push(root);
  const directory = resolve(root, ".agents/skills/repository-testing");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "SKILL.md"),
    "# Repository testing\n\nRun the bounded checks.\n",
  );
  const manifest: SkillManifest = {
    schemaVersion: 1,
    skillId: "repository/testing",
    version: "1.2.3",
    contentHash: await hashSkillPackage(directory),
    source: {
      kind: "project",
      uri: ".agents/skills/repository-testing",
      publisher: { id: "fixture", name: "Fixture" },
    },
    supportedRoles: ["developer"],
    compatibility: {
      providers: { mode: "any" },
      minimumRuntimeVersion: "0.1.0",
      platforms: [process.platform as "darwin" | "linux" | "win32"],
      requiredTools: [],
      unknownIsCompatible: false,
    },
    requiredCapabilities: ["filesystem.read"],
    contracts: {
      inputSchemaRef: "lervo-schema://skill/input/v1",
      outputSchemaRef: "lervo-schema://skill/output/v1",
    },
    trust: { level: "untrusted", signatureStatus: "unsigned" },
    enabledScope: { kind: "user" },
    pinned: false,
  };
  await writeFile(resolve(directory, "lervo-skill.json"), `${JSON.stringify(manifest)}\n`);
  return { root, directory, manifest };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project skill contract source units", () => {
  it("binds a validated package manifest and its instructions to stable skill locators", async () => {
    const { root, manifest } = await fixture();
    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_skillcontractsource",
      policy: defaultRepositoryKnowledgePolicy,
      observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
    });
    const units = scan.units.filter((unit) => unit.unitKind === "skill_contract");
    expect(units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".agents/skills/repository-testing/lervo-skill.json",
          locator: `skill:${manifest.skillId}@${manifest.version}/manifest`,
        }),
        expect.objectContaining({
          path: ".agents/skills/repository-testing/SKILL.md",
          locator: `skill:${manifest.skillId}@${manifest.version}/instructions`,
        }),
      ]),
    );
    expect(units).toHaveLength(2);
    expect(SKILL_CONTRACT_SOURCE_UNIT_ADAPTER).toBe("lervo-skill-contract-v1+skill-schema-v1");
  });

  it("fails closed when package bytes no longer match the manifest content hash", async () => {
    const { root, directory } = await fixture();
    const privateText = "private-changed-skill-fixture";
    await writeFile(resolve(directory, "SKILL.md"), privateText);
    const result = scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_skillcontractsource",
      policy: defaultRepositoryKnowledgePolicy,
      observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
    });
    await expect(result).rejects.toMatchObject({ code: "knowledge_unit_extraction_failed" });
    await expect(result).rejects.not.toThrow(privateText);
  });
});
