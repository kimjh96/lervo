import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ProviderRuntimeInspection } from "@lervo/adapter-contract";
import {
  applyInitPlan,
  createInitPlan,
  serializeYaml,
} from "@lervo/project";
import type { DocumentManifest, SkillManifest } from "@lervo/schemas";
import {
  discoverSkillRoot,
  hashSkillPackage,
  resolveSkills,
  writeSkillLock,
} from "@lervo/skills";
import { afterEach, describe, expect, it } from "vitest";

import { inspectDoctorEnvironment } from "../src/doctor-environment.js";

const roots: string[] = [];
const projectId = "prj_doctor_environment_01";

function available(provider: "codex" | "claude"): ProviderRuntimeInspection {
  return {
    provider,
    status: "available",
    source: provider === "codex" ? "path" : "bundled",
    version: `${provider} fixture 1.0.0`,
    reasonCode: "ready",
  };
}

async function repository(): Promise<{ root: string; userSkillRoot: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-doctor-environment-"));
  const userSkillRoot = await mkdtemp(resolve(tmpdir(), "lervo-doctor-user-skills-"));
  roots.push(root, userSkillRoot);
  await applyInitPlan(await createInitPlan({ root, projectId }));
  return { root, userSkillRoot };
}

async function inspect(root: string, userSkillRoot: string) {
  return inspectDoctorEnvironment(
    { repositoryRoot: root, projectId },
    {
      userSkillRoot,
      inspectCodex: async () => available("codex"),
      inspectClaude: async () => available("claude"),
    },
  );
}

async function addProjectSkill(root: string): Promise<{
  directory: string;
  manifest: SkillManifest;
}> {
  const directory = resolve(root, ".agents/skills/doctor-fixture");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "SKILL.md"), "# Doctor fixture\n");
  const manifest: SkillManifest = {
    schemaVersion: 1,
    skillId: "doctor/fixture",
    version: "1.0.0",
    contentHash: await hashSkillPackage(directory),
    source: {
      kind: "project",
      uri: ".agents/skills/doctor-fixture",
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
    requiredCapabilities: [],
    contracts: {
      inputSchemaRef: "lervo-schema://doctor/input/v1",
      outputSchemaRef: "lervo-schema://doctor/output/v1",
    },
    trust: { level: "untrusted", signatureStatus: "unsigned" },
    enabledScope: { kind: "user" },
    pinned: false,
  };
  await writeFile(resolve(directory, "lervo-skill.json"), `${JSON.stringify(manifest)}\n`);
  return { directory, manifest };
}

function missingDocumentManifest(): DocumentManifest {
  return {
    schemaVersion: 1,
    documentId: "doc_doctor_missing_01",
    record: {
      path: "docs/missing.md",
      kind: "observed",
      responsibleParty: { kind: "team", id: "docs" },
      connectedPaths: ["src"],
      verifiedRevision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      verifiedAt: "2026-08-19T00:00:00.000Z",
      reviewIntervalDays: 30,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "project.docs",
      locale: "ko-KR",
      audience: "human",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      automaticWrites: false,
      splitRecommendedAtBytes: 32768,
      oversizeReviewAtBytes: 65536,
      overflowAction: "report_split_recommended",
    },
    relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("doctor project environment inspection", () => {
  it("marks every inspected empty environment explicitly healthy", async () => {
    const { root, userSkillRoot } = await repository();
    const result = await inspect(root, userSkillRoot);

    expect(result).toHaveLength(10);
    expect(result.map((item) => item.check.status)).toEqual(Array(10).fill("healthy"));
    expect(result.find((item) => item.check.checkId === "provider_claude_runtime")?.check)
      .toMatchObject({ version: "claude fixture 1.0.0", observedCount: 1 });
  });

  it.each([
    ["knowledge", [], 0],
    ["documents", ["document_registry", "document_sources"], 0],
    ["skills", ["skill_packages", "skill_lock"], 0],
    ["providers", ["provider_codex_runtime", "provider_claude_runtime"], 2],
    ["search", [
      "search_engine_selection",
      "search_rollout_policies",
      "search_rollout_reviews",
      "search_rollout_actions",
    ], 0],
  ] as const)("runs only %s inspectors for a limited scope", async (
    scope,
    expectedCheckIds,
    expectedProviderCalls,
  ) => {
    const { root, userSkillRoot } = await repository();
    let providerCalls = 0;
    const result = await inspectDoctorEnvironment(
      { repositoryRoot: root, projectId, scope },
      {
        userSkillRoot,
        inspectCodex: async () => {
          providerCalls += 1;
          return available("codex");
        },
        inspectClaude: async () => {
          providerCalls += 1;
          return available("claude");
        },
      },
    );

    expect(providerCalls).toBe(expectedProviderCalls);
    expect(result.map((item) => item.check.checkId)).toEqual(expectedCheckIds);
  });

  it("does not call a missing registered document source healthy", async () => {
    const { root, userSkillRoot } = await repository();
    const manifest = missingDocumentManifest();
    await writeFile(
      resolve(root, ".lervo/documents", `${manifest.documentId}.yaml`),
      serializeYaml(manifest),
    );

    const result = await inspect(root, userSkillRoot);
    expect(result.find((item) => item.check.checkId === "document_registry")?.check.status)
      .toBe("healthy");
    expect(result.find((item) => item.check.checkId === "document_sources"))
      .toMatchObject({
        check: { status: "unhealthy", observedCount: 1 },
        issues: [{ code: "document_source_invalid" }],
      });
  });

  it("distinguishes unresolved skills from invalid skill bytes", async () => {
    const { root, userSkillRoot } = await repository();
    const { directory, manifest } = await addProjectSkill(root);

    const unresolved = await inspect(root, userSkillRoot);
    expect(unresolved.find((item) => item.check.checkId === "skill_lock"))
      .toMatchObject({
        check: { status: "unknown" },
        issues: [{ code: "skill_lock_missing" }],
      });

    await writeFile(resolve(directory, "SKILL.md"), "# Changed without a new hash\n");
    const invalid = await inspect(root, userSkillRoot);
    expect(invalid.find((item) => item.check.checkId === "skill_packages"))
      .toMatchObject({
        check: { status: "unhealthy" },
        issues: [{ code: "skill_package_invalid" }],
      });

    manifest.contentHash = await hashSkillPackage(directory);
    await writeFile(resolve(directory, "lervo-skill.json"), `${JSON.stringify(manifest)}\n`);
    const candidates = await discoverSkillRoot({
      root: resolve(root, ".agents/skills"),
      sourceKind: "project",
      sourceUriPrefix: ".agents/skills",
    });
    const lock = resolveSkills({
      requestedSkillIds: [manifest.skillId],
      candidates,
      runtime: {
        projectId,
        provider: "codex",
        roleId: "developer",
        runtimeVersion: "0.1.0",
        platform: process.platform as "darwin" | "linux" | "win32",
        availableTools: [],
        allowedCapabilities: [],
      },
      generatedAt: "2026-08-19T00:00:00.000Z",
    }).lock;
    await writeSkillLock(resolve(root, ".lervo/skills.lock"), lock);
    const current = await inspect(root, userSkillRoot);
    expect(current.find((item) => item.check.checkId === "skill_lock")?.check.status)
      .toBe("healthy");

    await writeFile(resolve(directory, "SKILL.md"), "# Changed again\n");
    manifest.contentHash = await hashSkillPackage(directory);
    await writeFile(resolve(directory, "lervo-skill.json"), `${JSON.stringify(manifest)}\n`);
    const stale = await inspect(root, userSkillRoot);
    expect(stale.find((item) => item.check.checkId === "skill_packages")?.check.status)
      .toBe("healthy");
    expect(stale.find((item) => item.check.checkId === "skill_lock"))
      .toMatchObject({
        check: { status: "unhealthy" },
        issues: [{ code: "skill_lock_stale" }],
      });
  });
});
