import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyRepositoryLayoutMigrationPlan,
  createDocumentMoveLineage,
  createRepositoryLayoutMigrationPlan,
  inspectRepositoryDocumentRewriters,
  lintRepositoryKnowledge,
  recoverKnowledgeMaterialization,
  sha256,
  stableId,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-layout-migration-"));
  roots.push(root);
  await writeFile(
    resolve(root, "README.md"),
    "# Example\n\nSee [architecture](./EXAMPLE_ARCHITECTURE.md) and EXAMPLE_VISION.md.\n",
  );
  await writeFile(
    resolve(root, "EXAMPLE_ARCHITECTURE.md"),
    "# Architecture\n\nSystem boundaries. See [vision](./EXAMPLE_VISION.md).\n",
  );
  await writeFile(resolve(root, "EXAMPLE_VISION.md"), "# \uBE44\uC804\n\nProduct intent.\n");
  await writeFile(
    resolve(root, "check.mjs"),
    "const docs = ['EXAMPLE_ARCHITECTURE.md', 'EXAMPLE_VISION.md'];\n",
  );
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_layout_migration",
      now: new Date("2026-08-23T00:00:00.000Z"),
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository layout migration", () => {
  it("plans and atomically applies classified root moves with exact reference updates", async () => {
    const root = await repository();
    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    expect(plan).toMatchObject({ status: "review_required" });
    expect(plan.moves.map((move) => [move.fromPath, move.toPath])).toEqual([
      ["EXAMPLE_ARCHITECTURE.md", "docs/architecture/system.md"],
      ["EXAMPLE_VISION.md", "docs/product/vision.md"],
    ]);
    expect(plan.referenceUpdates.map((item) => item.path)).toEqual([
      "check.mjs",
      "docs/architecture/system.md",
      "README.md",
    ]);
    await applyRepositoryLayoutMigrationPlan({
      plan,
      approvals: plan.moves.map((move) => ({
        operationId: move.operationId,
        approvalHash: move.approvalHash,
      })),
      now: new Date("2026-08-23T00:01:00.000Z"),
      recordApplied: () => undefined,
    });
    await expect(access(resolve(root, "EXAMPLE_ARCHITECTURE.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(root, "docs/architecture/system.md"), "utf8")).toContain(
      "System boundaries",
    );
    expect(await readFile(resolve(root, "docs/architecture/system.md"), "utf8")).toContain(
      "../product/vision.md",
    );
    expect(await readFile(resolve(root, "README.md"), "utf8")).toContain(
      "./docs/architecture/system.md",
    );
    expect(await readFile(resolve(root, "check.mjs"), "utf8")).toContain("docs/product/vision.md");
    expect((await lintRepositoryKnowledge(root)).valid).toBe(true);
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).status).toBe(
      "current",
    );
  });

  it("moves discovered documents from docs and nested repository locations into semantic routes", async () => {
    const root = await repository();
    await mkdir(resolve(root, "apps/web/notes"), { recursive: true });
    await mkdir(resolve(root, "docs"), { recursive: true });
    await writeFile(
      resolve(root, "docs/runtime-recovery.md"),
      "# Runtime recovery runbook\n\nSee [web API](../apps/web/notes/public-api.md).\n",
    );
    await writeFile(
      resolve(root, "apps/web/notes/public-api.md"),
      "# Public API compatibility\n\nSee [runbook](../../../docs/runtime-recovery.md).\n",
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromPath: "apps/web/notes/public-api.md",
          toPath: "docs/architecture/public-api.md",
          classification: "document",
        }),
        expect.objectContaining({
          fromPath: "docs/runtime-recovery.md",
          toPath: "docs/operations/runtime-recovery.md",
          classification: "document",
        }),
      ]),
    );
    await applyRepositoryLayoutMigrationPlan({
      plan,
      approvals: plan.moves.map((move) => ({
        operationId: move.operationId,
        approvalHash: move.approvalHash,
      })),
      now: new Date(),
      recordApplied: () => undefined,
    });
    await expect(access(resolve(root, "docs/runtime-recovery.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(resolve(root, "apps/web/notes/public-api.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(root, "docs/operations/runtime-recovery.md"), "utf8")).toContain(
      "../architecture/public-api.md",
    );
    expect(await readFile(resolve(root, "docs/architecture/public-api.md"), "utf8")).toContain(
      "../operations/runtime-recovery.md",
    );
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).status).toBe(
      "current",
    );
  });

  it("blocks unclassified discovered documents instead of leaving them as a completed migration", async () => {
    const root = await repository();
    await mkdir(resolve(root, "misc"), { recursive: true });
    await writeFile(resolve(root, "misc/purple-zebra.md"), "# Purple zebra quorum\n\nNotes.\n");

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "unclassified_document", path: "misc/purple-zebra.md" }),
    );
  });

  it("uses explicit document route metadata when title inference is unavailable", async () => {
    const root = await repository();
    await mkdir(resolve(root, "notes"), { recursive: true });
    await writeFile(
      resolve(root, "notes/zebra.md"),
      [
        "---",
        "lervo:",
        "  document:",
        "    route: quality",
        "---",
        "# Purple zebra quorum",
        "",
      ].join("\n"),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: "notes/zebra.md",
        toPath: "docs/quality/zebra.md",
        routeId: "quality",
        classificationBasis: "explicit_metadata",
      }),
    );
  });

  it("does not exempt a legacy documentation-root README by basename", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs"), { recursive: true });
    await writeFile(
      resolve(root, "docs/README.md"),
      [
        "---",
        "lervo:",
        "  document:",
        "    route: development",
        "    filename: documentation-governance.md",
        "---",
        "# Documentation governance",
        "",
        "Canonical-document precedence and update rules.",
        "",
      ].join("\n"),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: "docs/README.md",
        toPath: "docs/development/documentation-governance.md",
        routeId: "development",
        classificationBasis: "explicit_metadata",
      }),
    );
  });

  it("keeps a subsystem README as its local human entrypoint", async () => {
    const root = await repository();
    await mkdir(resolve(root, "packages/widget"), { recursive: true });
    await writeFile(
      resolve(root, "packages/widget/README.md"),
      "# Widget package\n\nLocal usage.\n",
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves.some((move) => move.fromPath === "packages/widget/README.md")).toBe(false);
    expect(plan.blockers.some((blocker) => blocker.path === "packages/widget/README.md")).toBe(
      false,
    );
  });

  it("returns a blocked plan instead of projecting colliding destinations", async () => {
    const root = await repository();
    await mkdir(resolve(root, "apps/hub"), { recursive: true });
    await mkdir(resolve(root, "apps/node"), { recursive: true });
    await writeFile(
      resolve(root, "apps/hub/DISTRIBUTION_GUIDE.md"),
      "# Distribution guide\n\nHub package.\n",
    );
    await writeFile(
      resolve(root, "apps/node/DISTRIBUTION_GUIDE.md"),
      "# Distribution guide\n\nNode package.\n",
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).toBe("blocked");
    expect(
      plan.blockers.filter((blocker) => blocker.code === "ambiguous_destination"),
    ).toHaveLength(2);
    expect(plan.moves.some((move) => move.fromPath.endsWith("DISTRIBUTION_GUIDE.md"))).toBe(false);
  });

  it("moves Claude-only behavioral rules to canonical instruction docs and routes them from AGENTS", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, "AGENTS.md"),
      "# Repository instructions\n\nKeep changes bounded.\n",
    );
    await mkdir(resolve(root, ".claude/rules"), { recursive: true });
    await writeFile(
      resolve(root, ".claude/rules/api.md"),
      [
        "---",
        "description: Public API contract",
        "globs: apps/api/**/*.{ts,tsx}, packages/api/**/*.ts",
        "---",
        "# API rules",
        "",
        "Keep compatibility explicit.",
        "",
      ].join("\n"),
    );
    await writeFile(
      resolve(root, "check.mjs"),
      [
        "const legacyDirectory = '.claude/rules';",
        "const exactRule = '.claude/rules/api.md';",
        "",
      ].join("\n"),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: ".claude/rules/api.md",
        toPath: "docs/instructions/architecture/api.md",
        classification: "instruction",
        reason: "normalized_provider_instruction",
      }),
    );
    expect(plan.referenceUpdates).toContainEqual(expect.objectContaining({ path: "AGENTS.md" }));
    await applyRepositoryLayoutMigrationPlan({
      plan,
      approvals: plan.moves.map((move) => ({
        operationId: move.operationId,
        approvalHash: move.approvalHash,
      })),
      now: new Date(),
      recordApplied: () => undefined,
    });
    await expect(access(resolve(root, ".claude/rules/api.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await readFile(resolve(root, "docs/instructions/architecture/api.md"), "utf8"),
    ).toContain("Keep compatibility explicit.");
    const agents = await readFile(resolve(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("block=repository_instruction_routes");
    expect(agents).toContain("`apps/api/**/*.{ts,tsx}`");
    expect(agents).toContain("`packages/api/**/*.ts`");
    expect(agents).toContain("docs/instructions/architecture/api.md");
    const references = await readFile(resolve(root, "check.mjs"), "utf8");
    expect(references).toContain("'.claude/rules'");
    expect(references).toContain("'docs/instructions/architecture/api.md'");
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).status).toBe(
      "current",
    );
  });

  it("moves Claude-only skill packages to the shared Agent Skills location and routes them from AGENTS", async () => {
    const root = await repository();
    await writeFile(resolve(root, "AGENTS.md"), "# Repository instructions\n");
    await mkdir(resolve(root, ".claude/skills/health/references"), { recursive: true });
    await writeFile(
      resolve(root, ".claude/skills/health/SKILL.md"),
      "---\nname: health\ndescription: Inspect service health\n---\n\n# Health\n",
    );
    await writeFile(
      resolve(root, ".claude/skills/health/references/checks.md"),
      "# Runtime checks\n",
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromPath: ".claude/skills/health/SKILL.md",
          toPath: ".agents/skills/health/SKILL.md",
          classification: "skill",
        }),
        expect.objectContaining({
          fromPath: ".claude/skills/health/references/checks.md",
          toPath: ".agents/skills/health/references/checks.md",
          classification: "skill",
        }),
      ]),
    );
    await applyRepositoryLayoutMigrationPlan({
      plan,
      approvals: plan.moves.map((move) => ({
        operationId: move.operationId,
        approvalHash: move.approvalHash,
      })),
      now: new Date(),
      recordApplied: () => undefined,
    });
    await expect(access(resolve(root, ".claude/skills/health/SKILL.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(root, ".agents/skills/health/SKILL.md"), "utf8")).toContain(
      "Inspect service health",
    );
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain(
      "matches the `health` skill",
    );
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).status).toBe(
      "current",
    );
  });

  it("requires every item approval and rolls back all moves after interruption", async () => {
    const root = await repository();
    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    await expect(
      applyRepositoryLayoutMigrationPlan({
        plan,
        approvals: [],
        now: new Date(),
        recordApplied: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_approval_required" });
    const changed = plan.operations.filter(
      (operation) =>
        operation.action === "create" ||
        operation.action === "update" ||
        operation.action === "move",
    );
    await expect(
      applyRepositoryLayoutMigrationPlan({
        plan,
        approvals: plan.moves.map((move) => ({
          operationId: move.operationId,
          approvalHash: move.approvalHash,
        })),
        now: new Date(),
        recordApplied: () => undefined,
        failureInjector: (checkpoint) =>
          checkpoint === `published:${changed.length - 1}` ? "interrupt" : undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_recovery_required" });
    expect(
      (await recoverKnowledgeMaterialization({ repositoryRoot: root, eventRecorded: () => false }))
        .disposition,
    ).toBe("rolled_back");
    expect(await readFile(resolve(root, "EXAMPLE_ARCHITECTURE.md"), "utf8")).toContain(
      "System boundaries",
    );
    await expect(access(resolve(root, "docs/architecture/system.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).planId).toBe(
      plan.planId,
    );
  });

  it("groups flat ADR directories by bounded semantic domains", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/adr"), { recursive: true });
    await writeFile(
      resolve(root, "docs/adr/0001-security.md"),
      "# ADR-0001: Credential security boundary\n\nDecision.\n",
    );
    await writeFile(
      resolve(root, "docs/adr/0002-database.md"),
      "# ADR-0002: Database schema migration\n\nDecision.\n",
    );
    await writeFile(
      resolve(root, "docs/adr/0003-architecture.md"),
      "# ADR-0003: Web protocol architecture\n\nDecision.\n",
    );
    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    expect(plan.moves.map((move) => [move.fromPath, move.toPath, move.group])).toEqual(
      expect.arrayContaining([
        ["docs/adr/0001-security.md", "docs/decisions/security/0001-security.md", "security"],
        ["docs/adr/0002-database.md", "docs/decisions/data/0002-database.md", "data"],
        [
          "docs/adr/0003-architecture.md",
          "docs/decisions/architecture/0003-architecture.md",
          "architecture",
        ],
      ]),
    );
  });

  it("blocks an unclassified flat ADR instead of falling back to foundation", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/adr"), { recursive: true });
    await writeFile(
      resolve(root, "docs/adr/0004-zebra.md"),
      "# ADR-0004: Purple zebra quorum\n\nDecision.\n",
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).toBe("blocked");
    expect(plan.moves.some((move) => move.fromPath.endsWith("0004-zebra.md"))).toBe(false);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "unclassified_decision", path: "docs/adr/0004-zebra.md" }),
    );
  });

  it("uses explicit ADR route metadata without requiring title inference", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/adr"), { recursive: true });
    await writeFile(
      resolve(root, "docs/adr/0005-zebra.md"),
      [
        "---",
        "lervo:",
        "  decision:",
        "    taxonomy: decisions.default",
        "    route: product",
        "---",
        "# ADR-0005: Purple zebra quorum",
        "",
        "Decision.",
        "",
      ].join("\n"),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    const move = plan.moves.find((item) => item.fromPath === "docs/adr/0005-zebra.md");

    expect(move).toMatchObject({
      toPath: "docs/decisions/product/0005-zebra.md",
      routeId: "product",
      classificationBasis: "explicit_metadata",
      matchedTitleTerms: [],
    });
  });

  it("uses repository-defined routes instead of a hardcoded Lervo domain list", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, ".lervo/knowledge/document-layout.yaml"),
      [
        "schemaVersion: 1",
        "taxonomyId: decisions.example",
        "decisionRoot: records/decisions",
        "legacyRoots:",
        "  - records/adr",
        "maxLeafDocuments: 12",
        "routes:",
        "  - id: platform.api",
        "    path: platform/api",
        "    priority: 10",
        "    minimumTitleTermMatches: 1",
        "    titleTerms:",
        "      - public api",
        "",
      ].join("\n"),
    );
    await mkdir(resolve(root, "records/adr"), { recursive: true });
    await writeFile(
      resolve(root, "records/adr/0006-api.md"),
      "# ADR-0006: Public API compatibility\n\nDecision.\n",
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: "records/adr/0006-api.md",
        toPath: "records/decisions/platform/api/0006-api.md",
        routeId: "platform.api",
        classificationBasis: "title_terms",
        matchedTitleTerms: ["public api"],
      }),
    );
  });

  it("blocks equal strongest repository route matches", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, ".lervo/knowledge/document-layout.yaml"),
      [
        "schemaVersion: 1",
        "taxonomyId: decisions.ambiguous",
        "decisionRoot: docs/decisions",
        "legacyRoots:",
        "  - docs/adr",
        "maxLeafDocuments: 24",
        "routes:",
        "  - id: alpha",
        "    path: alpha",
        "    priority: 10",
        "    minimumTitleTermMatches: 1",
        "    titleTerms:",
        "      - quorum",
        "  - id: beta",
        "    path: beta",
        "    priority: 10",
        "    minimumTitleTermMatches: 1",
        "    titleTerms:",
        "      - quorum",
        "",
      ].join("\n"),
    );
    await mkdir(resolve(root, "docs/adr"), { recursive: true });
    await writeFile(
      resolve(root, "docs/adr/0007-quorum.md"),
      "# ADR-0007: Durable quorum\n\nDecision.\n",
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({
        code: "ambiguous_decision_route",
        path: "docs/adr/0007-quorum.md",
        candidateRouteIds: ["alpha", "beta"],
      }),
    );
  });

  it("blocks configured decision leaves that exceed their repository limit", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/decisions/architecture"), { recursive: true });
    await Promise.all(
      Array.from({ length: 25 }, (_, index) => {
        const number = String(index + 1).padStart(4, "0");
        return writeFile(
          resolve(root, `docs/decisions/architecture/${number}-architecture.md`),
          `# ADR-${number}: Architecture component ${number}\n\nDecision.\n`,
        );
      }),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({
        code: "decision_leaf_overflow",
        path: "docs/decisions/architecture",
        configuredMaximum: 24,
        observedCount: 25,
      }),
    );
  });

  it("reclassifies only lineage-backed documents previously sent to the foundation fallback", async () => {
    const root = await repository();
    const content = "# ADR-0008: Bounded environment doctor\n\nDecision.\n";
    const identityPath = "docs/adr/0008-doctor.md";
    const currentPath = "docs/decisions/foundation/0008-doctor.md";
    await mkdir(resolve(root, "docs/decisions/foundation"), { recursive: true });
    await writeFile(resolve(root, currentPath), content);
    const lineage = createDocumentMoveLineage({
      projectId: "prj_layout_migration",
      operationId: stableId("kdocop", { fixture: "legacy-foundation-fallback" }),
      fromPath: identityPath,
      toPath: currentPath,
      identityPath,
      sourceId: stableId("src", { projectId: "prj_layout_migration", path: identityPath }),
      sourceContentHash: sha256(content),
      sourceUnitIds: [
        stableId("unit", {
          projectId: "prj_layout_migration",
          sourceKind: "documentation",
          path: identityPath,
          unitKind: "file",
          locator: "file:/",
        }),
        stableId("unit", {
          projectId: "prj_layout_migration",
          sourceKind: "documentation",
          path: identityPath,
          unitKind: "markdown_section",
          locator: "heading:ADR-0008: Bounded environment doctor",
        }),
      ],
    });
    await mkdir(resolve(root, lineage.file.slice(0, lineage.file.lastIndexOf("/"))), {
      recursive: true,
    });
    await writeFile(resolve(root, lineage.file), lineage.content);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: currentPath,
        toPath: "docs/decisions/operations/0008-doctor.md",
        routeId: "operations",
        classificationBasis: "title_terms",
      }),
    );
  });

  it("reclassifies lineage-backed documents when a repository retires a broad route", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, ".lervo/knowledge/document-layout.yaml"),
      [
        "schemaVersion: 1",
        "taxonomyId: decisions.refined",
        "decisionRoot: docs/decisions",
        "legacyRoots:",
        "  - docs/adr",
        "maxLeafDocuments: 24",
        "routes:",
        "  - id: operations.trace",
        "    path: operations/trace",
        "    priority: 10",
        "    minimumTitleTermMatches: 1",
        "    titleTerms:",
        "      - trace",
        "",
      ].join("\n"),
    );
    const content = "# ADR-0009: Bounded trace pages\n\nDecision.\n";
    const identityPath = "docs/adr/0009-trace.md";
    const currentPath = "docs/decisions/operations/0009-trace.md";
    await mkdir(resolve(root, "docs/decisions/operations"), { recursive: true });
    await writeFile(resolve(root, currentPath), content);
    const lineage = createDocumentMoveLineage({
      projectId: "prj_layout_migration",
      operationId: stableId("kdocop", { fixture: "retired-broad-route" }),
      fromPath: identityPath,
      toPath: currentPath,
      identityPath,
      sourceId: stableId("src", { projectId: "prj_layout_migration", path: identityPath }),
      sourceContentHash: sha256(content),
      sourceUnitIds: [
        stableId("unit", {
          projectId: "prj_layout_migration",
          sourceKind: "documentation",
          path: identityPath,
          unitKind: "file",
          locator: "file:/",
        }),
        stableId("unit", {
          projectId: "prj_layout_migration",
          sourceKind: "documentation",
          path: identityPath,
          unitKind: "markdown_section",
          locator: "heading:ADR-0009: Bounded trace pages",
        }),
      ],
    });
    await mkdir(resolve(root, lineage.file.slice(0, lineage.file.lastIndexOf("/"))), {
      recursive: true,
    });
    await writeFile(resolve(root, lineage.file), lineage.content);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).toBe("review_required");
    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: currentPath,
        toPath: "docs/decisions/operations/trace/0009-trace.md",
        routeId: "operations.trace",
      }),
    );
    expect(plan.blockers).toEqual([]);
    await applyRepositoryLayoutMigrationPlan({
      plan,
      approvals: plan.moves.map((move) => ({
        operationId: move.operationId,
        approvalHash: move.approvalHash,
      })),
      now: new Date(),
      recordApplied: async () => {
        expect(
          (await lintRepositoryKnowledge(root, { allowTransactionPlanId: plan.planId })).valid,
        ).toBe(true);
      },
    });
    await expect(access(resolve(root, currentPath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(resolve(root, "docs/decisions/operations/trace/0009-trace.md")),
    ).resolves.toBeUndefined();
  });

  it("moves legacy machine artifacts without user-byte approval", async () => {
    const root = await repository();
    const initial = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    await applyRepositoryLayoutMigrationPlan({
      plan: initial,
      approvals: initial.moves.map((move) => ({
        operationId: move.operationId,
        approvalHash: move.approvalHash,
      })),
      now: new Date(),
      recordApplied: () => undefined,
    });
    await mkdir(resolve(root, ".lervo/state/knowledge/candidates"), { recursive: true });
    const id = "kcomp_aaaaaaaaaaaaaaaaaaaaaaaa";
    await writeFile(resolve(root, `.lervo/state/knowledge/candidates/${id}.json`), "{}\n");
    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    expect(plan).toMatchObject({
      status: "ready",
      moves: [],
      machineMoves: [
        expect.objectContaining({
          fromPath: `.lervo/state/knowledge/candidates/${id}.json`,
          toPath: `.lervo/state/knowledge/candidates/aa/${id}.json`,
        }),
      ],
    });
    await applyRepositoryLayoutMigrationPlan({
      plan,
      approvals: [],
      now: new Date(),
      recordApplied: () => undefined,
    });
    await expect(
      access(resolve(root, `.lervo/state/knowledge/candidates/${id}.json`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(resolve(root, `.lervo/state/knowledge/candidates/aa/${id}.json`)),
    ).resolves.toBeUndefined();
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).status).toBe(
      "current",
    );
  });

  it("reconciles the managed Prettier block for current normalization ownership", async () => {
    const root = await repository();
    const initial = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    await applyRepositoryLayoutMigrationPlan({
      plan: initial,
      approvals: [...initial.moves, ...initial.userUpdates].map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
      now: new Date(),
      recordApplied: () => undefined,
    });
    const content = await readFile(resolve(root, "README.md"), "utf8");
    const recordId = "knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa";
    const directory = resolve(root, ".lervo/knowledge/document-normalizations/aa");
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `${recordId}.yaml`),
      [
        `recordId: ${recordId}`,
        "schemaVersion: 2",
        "outputLanguage: en",
        "formatVersion: lervo.document.v1",
        "sourcePath: README.md",
        `sourceContentHash: ${sha256(content)}`,
        "resourceBindings: []",
        "byteOwnership:",
        "  owner: reviewer",
        "  rewritePolicy: reviewed_exact",
        "outputs:",
        "  - path: README.md",
        `    contentHash: ${sha256(content)}`,
        "",
      ].join("\n"),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).toBe("ready");
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: ".prettierignore", action: "create" }),
    );
    let transactionLint: Awaited<ReturnType<typeof lintRepositoryKnowledge>> | undefined;
    await applyRepositoryLayoutMigrationPlan({
      plan,
      approvals: [],
      now: new Date(),
      recordApplied: async () => {
        transactionLint = await lintRepositoryKnowledge(root, {
          allowTransactionPlanId: plan.planId,
        });
      },
    });
    const afterRewrite = await inspectRepositoryDocumentRewriters({ repositoryRoot: root });
    expect(await readFile(resolve(root, ".prettierignore"), "utf8")).toBe(
      afterRewrite.prettierIgnore.afterContent,
    );
    expect(transactionLint?.issues).not.toContainEqual(
      expect.objectContaining({ code: "document_rewrite_ownership_conflict" }),
    );
    expect(await readFile(resolve(root, ".prettierignore"), "utf8")).toContain("README.md");
  });
});
