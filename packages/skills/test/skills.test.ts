import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { SkillManifest } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  compareSemver,
  discoverSkillRoot,
  hashSkillPackage,
  readSkillLock,
  resolveSkills,
  writeSkillLock,
} from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-skills-"));
  roots.push(root);
  return root;
}

function runtime() {
  return {
    projectId: "prj_skills_0001",
    provider: "codex",
    roleId: "developer",
    runtimeVersion: "0.1.0",
    platform: "darwin" as const,
    availableTools: ["filesystem.read", "shell"],
    allowedCapabilities: ["filesystem.read", "shell.execute"],
  };
}

async function createSkill(input: {
  root: string;
  directory: string;
  sourceKind: "project" | "user";
  skillId?: string;
  version?: string;
  pinned?: boolean;
  provider?: string;
  minimumRuntimeVersion?: string;
  requiredTools?: string[];
}): Promise<{ directoryPath: string; manifest: SkillManifest; original: string }> {
  const directoryPath = resolve(input.root, input.directory);
  await mkdir(directoryPath, { recursive: true });
  const original = `# ${input.directory}\nHuman-readable source.\n`;
  await writeFile(resolve(directoryPath, "SKILL.md"), original);
  const contentHash = await hashSkillPackage(directoryPath);
  const manifest: SkillManifest = {
    schemaVersion: 1,
    skillId: input.skillId ?? "repository/testing",
    version: input.version ?? "1.0.0",
    contentHash,
    source: {
      kind: input.sourceKind,
      uri: `declared://${input.directory}`,
      publisher: { id: "fixture", name: "Fixture" },
    },
    supportedRoles: ["developer"],
    compatibility: {
      providers: input.provider === undefined
        ? { mode: "any" }
        : { mode: "allowlist", providers: [input.provider] },
      minimumRuntimeVersion: input.minimumRuntimeVersion ?? "0.1.0",
      platforms: ["darwin"],
      requiredTools: input.requiredTools ?? ["shell"],
      unknownIsCompatible: false,
    },
    requiredCapabilities: ["filesystem.read"],
    contracts: {
      inputSchemaRef: "lervo-schema://skill/input/v1",
      outputSchemaRef: "lervo-schema://skill/output/v1",
    },
    trust: { level: "untrusted", signatureStatus: "unsigned" },
    enabledScope: { kind: "user" },
    pinned: input.pinned ?? false,
  };
  await writeFile(resolve(directoryPath, "lervo-skill.json"), `${JSON.stringify(manifest)}\n`);
  return { directoryPath, manifest, original };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local skill resolution", () => {
  it("uses a project pin before version and the highest version within one tier", async () => {
    const root = await temporaryRoot();
    const projectRoot = resolve(root, "project");
    const userRoot = resolve(root, "user");
    await createSkill({
      root: projectRoot,
      directory: "pinned",
      sourceKind: "project",
      version: "1.0.0",
      pinned: true,
    });
    await createSkill({
      root: projectRoot,
      directory: "newer-project",
      sourceKind: "project",
      version: "9.0.0",
    });
    await createSkill({
      root: userRoot,
      directory: "older-user",
      sourceKind: "user",
      version: "2.0.0",
    });
    await createSkill({
      root: userRoot,
      directory: "newer-user",
      sourceKind: "user",
      version: "3.0.0",
    });
    const projectCandidates = await discoverSkillRoot({
      root: projectRoot,
      sourceKind: "project",
      sourceUriPrefix: ".agents/skills",
    });
    const userCandidates = await discoverSkillRoot({
      root: userRoot,
      sourceKind: "user",
      sourceUriPrefix: "~/.agents/skills",
    });
    expect(resolveSkills({
      requestedSkillIds: ["repository/testing"],
      candidates: [...projectCandidates, ...userCandidates],
      runtime: runtime(),
      generatedAt: "2026-08-19T00:00:00Z",
    }).lock.entries[0]).toMatchObject({ version: "1.0.0", pinned: true });
    expect(resolveSkills({
      requestedSkillIds: ["repository/testing"],
      candidates: userCandidates,
      runtime: runtime(),
      generatedAt: "2026-08-19T00:00:00Z",
    }).lock.entries[0]).toMatchObject({ version: "3.0.0", source: { kind: "user" } });
    expect(compareSemver("1.0.0-alpha-beta", "1.0.0-alpha")).toBeGreaterThan(0);
  });

  it("prefers a project candidate and records deterministic shadowing without changing originals", async () => {
    const root = await temporaryRoot();
    const projectRoot = resolve(root, "project");
    const userRoot = resolve(root, "user");
    const project = await createSkill({
      root: projectRoot,
      directory: "testing-project",
      sourceKind: "project",
      version: "1.0.0",
    });
    await createSkill({
      root: userRoot,
      directory: "testing-user",
      sourceKind: "user",
      version: "9.0.0",
    });
    const candidates = [
      ...await discoverSkillRoot({
        root: projectRoot,
        sourceKind: "project",
        sourceUriPrefix: ".agents/skills",
      }),
      ...await discoverSkillRoot({
        root: userRoot,
        sourceKind: "user",
        sourceUriPrefix: "~/.agents/skills",
      }),
    ];
    const result = resolveSkills({
      requestedSkillIds: ["repository/testing", "repository/testing"],
      candidates,
      runtime: runtime(),
      generatedAt: "2026-08-19T00:00:00Z",
    });

    expect(result.lock.entries).toMatchObject([{
      version: "1.0.0",
      source: { kind: "project", uri: ".agents/skills/testing-project" },
    }]);
    expect(result.lock.rejected).toMatchObject([{
      version: "9.0.0",
      sourceKind: "user",
      reasonCode: "source_shadowed",
    }]);
    expect(await readFile(resolve(project.directoryPath, "SKILL.md"), "utf8"))
      .toBe(project.original);
  });

  it("fails closed when no candidate is compatible and preserves the reason", async () => {
    const root = await temporaryRoot();
    const fixture = await createSkill({
      root,
      directory: "future",
      sourceKind: "project",
      minimumRuntimeVersion: "2.0.0",
    });
    const candidates = await discoverSkillRoot({
      root,
      sourceKind: "project",
      sourceUriPrefix: ".agents/skills",
    });
    try {
      resolveSkills({
        requestedSkillIds: [fixture.manifest.skillId],
        candidates,
        runtime: runtime(),
        generatedAt: "2026-08-19T00:00:00Z",
      });
      throw new Error("An incompatible skill was selected.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "no_compatible_skill",
        reasons: ["runtime_incompatible"],
      });
    }
  });

  it("rejects changed content and symbolic links", async () => {
    const root = await temporaryRoot();
    const changed = await createSkill({ root, directory: "changed", sourceKind: "project" });
    await writeFile(resolve(changed.directoryPath, "SKILL.md"), "tampered\n");
    await expect(discoverSkillRoot({
      root,
      sourceKind: "project",
      sourceUriPrefix: ".agents/skills",
    })).rejects.toMatchObject({ code: "content_hash_mismatch" });

    const symlinkRoot = await temporaryRoot();
    const linked = await createSkill({ root: symlinkRoot, directory: "linked", sourceKind: "project" });
    await symlink(resolve(linked.directoryPath, "SKILL.md"), resolve(linked.directoryPath, "alias.md"));
    await expect(discoverSkillRoot({
      root: symlinkRoot,
      sourceKind: "project",
      sourceUriPrefix: ".agents/skills",
    })).rejects.toMatchObject({ code: "unsafe_skill_package" });
  });

  it("keeps an equivalent lock timestamp and refuses to overwrite an invalid lock", async () => {
    const root = await temporaryRoot();
    const path = resolve(root, "skills.lock");
    const empty = resolveSkills({
      requestedSkillIds: [],
      candidates: [],
      runtime: runtime(),
      generatedAt: "2026-08-19T00:00:00Z",
    }).lock;
    await expect(readSkillLock(resolve(root, "missing.lock"))).resolves.toBeNull();
    await writeSkillLock(path, empty);
    await expect(readSkillLock(path)).resolves.toEqual(empty);
    const second = await writeSkillLock(path, {
      ...empty,
      generatedAt: "2026-08-19T01:00:00Z",
    });
    expect(second.generatedAt).toBe("2026-08-19T00:00:00Z");

    await writeFile(path, "user-owned invalid bytes\n");
    await expect(writeSkillLock(path, empty)).rejects.toMatchObject({ code: "invalid_skill_lock" });
    expect(await readFile(path, "utf8")).toBe("user-owned invalid bytes\n");
  });
});
