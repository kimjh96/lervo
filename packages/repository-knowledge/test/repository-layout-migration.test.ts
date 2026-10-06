import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyInitPlan,
  createInitPlan,
  defaultDecisionTaxonomy,
  loadDecisionTaxonomy,
  type DecisionTaxonomy,
} from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyRepositoryLayoutMigrationPlan,
  classifyRepositoryDocument,
  createDocumentMoveLineage,
  createDocumentRouteClassificationRecords,
  createDocumentRouteClassificationRequest,
  createRepositoryLayoutMigrationPlan,
  interpretDocumentRouteClassificationResponse,
  loadDocumentRouteClassifications,
  recordDocumentRouteClassifications,
  inspectRepositoryDocumentRewriters,
  lintRepositoryKnowledge,
  recoverKnowledgeMaterialization,
  sha256,
  stableId,
} from "../src/index.js";

const roots: string[] = [];

/**
 * The fixture's two root documents are classified semantically, as the background resident
 * would, unless a test needs them unclassified.
 */
async function repository(options: { classifyRoots?: boolean } = {}): Promise<string> {
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
  if (options.classifyRoots !== false)
    await recordSemanticRoutes(root, [
      { path: "EXAMPLE_ARCHITECTURE.md", outcome: "role", roleId: "system_architecture" },
      { path: "EXAMPLE_VISION.md", outcome: "role", roleId: "product_vision" },
    ]);
  return root;
}

/**
 * Records what a no-capability semantic classifier answered for these documents, exactly as the
 * background resident does, so plans read real recorded evidence instead of title terms.
 */
async function recordSemanticRoutes(
  root: string,
  entries: Array<{
    path: string;
    subject?: "document" | "decision" | "instruction";
    outcome?: "route" | "role" | "retain_in_place" | "uncertain";
    routeId?: string | null;
    roleId?: string;
  }>,
): Promise<void> {
  const taxonomy = await loadDecisionTaxonomy(root);
  const documents = await Promise.all(
    entries.map(async (entry) => {
      const content = await readFile(resolve(root, entry.path), "utf8");
      return {
        subject: entry.subject ?? "document",
        path: entry.path,
        contentHash: sha256(content),
        workspacePackage: null,
        content,
      };
    }),
  );
  const { request, requestDigest } = createDocumentRouteClassificationRequest({
    taxonomy,
    documents,
  });
  const response = {
    classifications: entries.map((entry, index) => ({
      path: entry.path,
      contentHash: documents[index]!.contentHash,
      outcome: entry.outcome ?? "route",
      routeId: entry.outcome === undefined || entry.outcome === "route" ? entry.routeId! : null,
      roleId: entry.outcome === "role" ? entry.roleId! : null,
      rationale: "The document's purpose matches this route's described scope.",
    })),
  };
  await recordDocumentRouteClassifications({
    repositoryRoot: root,
    records: createDocumentRouteClassificationRecords({
      request,
      requestDigest,
      verdicts: interpretDocumentRouteClassificationResponse(request, response),
      provider: "codex",
      responseDigest: sha256(JSON.stringify(response)),
      observationArtifactHash: null,
      classifiedAt: new Date("2026-10-06T00:00:00.000Z"),
    }),
    liveClassificationIds: new Set((await loadDocumentRouteClassifications(root)).keys()),
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository layout migration", () => {
  it("plans and atomically applies classified root moves with exact reference updates", async () => {
    const root = await repository({ classifyRoots: false });
    const unclassified = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    // The `*_ARCHITECTURE` / `*_VISION` stems and their headings no longer place anything.
    expect(unclassified.moves).toEqual([]);
    expect(unclassified.blockers).toEqual([]);
    expect(unclassified.deferredDocuments.map((item) => item.path)).toEqual([
      "EXAMPLE_ARCHITECTURE.md",
      "EXAMPLE_VISION.md",
    ]);
    await recordSemanticRoutes(root, [
      { path: "EXAMPLE_ARCHITECTURE.md", outcome: "role", roleId: "system_architecture" },
      { path: "EXAMPLE_VISION.md", outcome: "role", roleId: "product_vision" },
    ]);
    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    expect(plan.moves.map((move) => move.classificationBasis)).toEqual([
      "semantic_provider",
      "semantic_provider",
    ]);
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

  it("places root role documents by explicit metadata or a declared legacy alias only", async () => {
    const root = await repository({ classifyRoots: false });
    await writeFile(
      resolve(root, "OVERVIEW.md"),
      ["---", "lervo:", "  document:", "    role: product_vision", "---", "# Overview", ""].join(
        "\n",
      ),
    );
    await writeFile(resolve(root, "ARCHITECTURE.md"), "# Notes\n\nNo heading keyword.\n");
    await writeFile(
      resolve(root, "PLAN.md"),
      ["---", "lervo:", "  document:", "    role: invented_role", "---", "# Plan", ""].join("\n"),
    );
    await writeFile(resolve(root, "V2_PLAN.md"), "# Version two plan\n\nRoadmap.\n");

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromPath: "OVERVIEW.md",
          toPath: "docs/product/vision.md",
          classification: "product",
          classificationBasis: "explicit_metadata",
        }),
        expect.objectContaining({
          fromPath: "ARCHITECTURE.md",
          toPath: "docs/architecture/system.md",
          classification: "architecture",
          classificationBasis: "reviewed_layout_alias",
        }),
      ]),
    );
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({
        code: "unknown_document_role",
        path: "PLAN.md",
        candidateRouteIds: ["invented_role"],
      }),
    );
    // The removed `V<n>_PLAN` stem rule no longer creates docs/roadmap/v2.md.
    expect(plan.moves.some((move) => move.fromPath === "V2_PLAN.md")).toBe(false);
    expect(plan.deferredDocuments.map((item) => item.path)).toContain("V2_PLAN.md");
  });

  it("defers a semantic role whose destination already exists instead of blocking", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/product"), { recursive: true });
    await writeFile(resolve(root, "docs/product/vision.md"), "# Vision\n\nCurrent.\n");
    await recordSemanticRoutes(root, [
      { path: "EXAMPLE_VISION.md", outcome: "role", roleId: "product_vision" },
    ]);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves.some((move) => move.fromPath === "EXAMPLE_VISION.md")).toBe(false);
    expect(plan.blockers).toEqual([]);
    expect(plan.deferredDocuments).toContainEqual(
      expect.objectContaining({
        path: "EXAMPLE_VISION.md",
        reason: "semantic_classification_uncertain",
      }),
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
    await recordSemanticRoutes(root, [
      { path: "apps/web/notes/public-api.md", routeId: "architecture" },
      { path: "docs/runtime-recovery.md", routeId: "operations" },
    ]);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromPath: "apps/web/notes/public-api.md",
          toPath: "docs/architecture/public-api.md",
          classification: "document",
          classificationBasis: "semantic_provider",
          semanticClassification: expect.objectContaining({
            provider: "codex",
            recordDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          }),
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

  it("defers a document no title term matches instead of blocking the plan", async () => {
    const root = await repository();
    await mkdir(resolve(root, "misc"), { recursive: true });
    await writeFile(resolve(root, "misc/purple-zebra.md"), "# Purple zebra quorum\n\nNotes.\n");

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).toBe("review_required");
    expect(plan.blockers).toEqual([]);
    expect(plan.moves.some((move) => move.fromPath === "misc/purple-zebra.md")).toBe(false);
    expect(plan.deferredDocumentCount).toBe(1);
    expect(plan.deferredDocuments).toEqual([
      expect.objectContaining({
        subject: "document",
        path: "misc/purple-zebra.md",
        reason: "semantic_classification_pending",
        workspacePackage: null,
        classificationId: expect.stringMatching(/^kdroute_[a-f0-9]{24}$/u),
      }),
    ]);
  });

  it("keeps a semantically uncertain document deferred until an owner or new bytes decide", async () => {
    const root = await repository();
    await mkdir(resolve(root, "misc"), { recursive: true });
    await writeFile(resolve(root, "misc/purple-zebra.md"), "# Purple zebra quorum\n\nNotes.\n");
    await recordSemanticRoutes(root, [{ path: "misc/purple-zebra.md", outcome: "uncertain" }]);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.blockers).toEqual([]);
    expect(plan.deferredDocuments).toEqual([
      expect.objectContaining({
        path: "misc/purple-zebra.md",
        reason: "semantic_classification_uncertain",
      }),
    ]);
    await writeFile(resolve(root, "misc/purple-zebra.md"), "# Purple zebra quorum\n\nEdited.\n");
    expect(
      (await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).deferredDocuments,
    ).toEqual([expect.objectContaining({ reason: "semantic_classification_pending" })]);
  });

  it("never routes a document its semantic classifier retains in place", async () => {
    const root = await repository();
    await mkdir(resolve(root, "fixtures"), { recursive: true });
    await writeFile(resolve(root, "fixtures/sample.md"), "# Sample\n\nRendered sample.\n");
    await recordSemanticRoutes(root, [{ path: "fixtures/sample.md", outcome: "retain_in_place" }]);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves.some((move) => move.fromPath === "fixtures/sample.md")).toBe(false);
    expect(plan.deferredDocuments).toEqual([]);
    expect(plan.retainedDocuments).toEqual([
      expect.objectContaining({ path: "fixtures/sample.md", basis: "semantic_provider" }),
    ]);
  });

  it("never treats application content its own workspace package loads as a migration candidate", async () => {
    const root = await repository();
    const data = "apps/web/app/[lang]/docs/_data";
    await mkdir(resolve(root, `${data}/writing-guide`), { recursive: true });
    await writeFile(
      resolve(root, "apps/web/package.json"),
      JSON.stringify({ name: "web", private: true }),
    );
    await writeFile(
      resolve(root, "apps/web/app/[lang]/docs/page.tsx"),
      [
        'import { readFile } from "node:fs/promises";',
        'import { join } from "node:path";',
        "",
        "export async function guide(slug: string): Promise<string> {",
        '  return readFile(join(process.cwd(), "app", "[lang]", "docs", "_data", `${slug}.md`), "utf8");',
        "}",
        "",
      ].join("\n"),
    );
    for (const [path, heading] of [
      [`${data}/writing-guide.md`, "Writing guide"],
      [`${data}/writing-guide/korean.md`, "Korean"],
      [`${data}/sentences.md`, "Sentences"],
      [`${data}/vocabulary.md`, "Vocabulary"],
    ] as const)
      await writeFile(resolve(root, path), `# ${heading}\n\nRendered by the web app.\n`);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    const paths = [
      `${data}/sentences.md`,
      `${data}/vocabulary.md`,
      `${data}/writing-guide.md`,
      `${data}/writing-guide/korean.md`,
    ];
    expect(plan.blockers).toEqual([]);
    expect(plan.deferredDocuments).toEqual([]);
    expect(plan.moves.some((move) => paths.includes(move.fromPath))).toBe(false);
    expect(plan.retainedDocuments).toEqual(
      paths.map((path) => ({
        path,
        basis: "application_content",
        evidence: [
          {
            kind: "source_reference",
            packageRoot: "apps/web",
            sourcePath: "apps/web/app/[lang]/docs/page.tsx",
            target: data,
            targetKind: "directory",
          },
        ],
      })),
    );
  });

  it("lets explicit document metadata place Markdown its package also loads", async () => {
    const root = await repository();
    await mkdir(resolve(root, "apps/web/content"), { recursive: true });
    await writeFile(resolve(root, "apps/web/package.json"), "{}\n");
    await writeFile(
      resolve(root, "apps/web/load.ts"),
      'export const content = import.meta.glob("./content/*.md");\n',
    );
    await writeFile(
      resolve(root, "apps/web/content/release-notes.md"),
      ["---", "lervo:", "  document:", "    route: delivery", "---", "# Notes", ""].join("\n"),
    );
    await writeFile(resolve(root, "apps/web/content/home.md"), "# Home\n");

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: "apps/web/content/release-notes.md",
        toPath: "docs/delivery/release-notes.md",
        classificationBasis: "explicit_metadata",
      }),
    );
    expect(plan.retainedDocuments).toContainEqual(
      expect.objectContaining({
        path: "apps/web/content/home.md",
        basis: "application_content",
        evidence: [expect.objectContaining({ kind: "source_reference", targetKind: "glob" })],
      }),
    );
  });

  it("preserves canonical archive and inherited collection boundaries", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/archive"), { recursive: true });
    await mkdir(resolve(root, "docs/inherited/legacy/knowledge"), { recursive: true });
    await writeFile(
      resolve(root, "docs/archive/purple-zebra.md"),
      "# Purple zebra quorum\n\nPreserved [architecture](../../EXAMPLE_ARCHITECTURE.md).\n",
    );
    await writeFile(
      resolve(root, "docs/inherited/legacy/knowledge/finding.md"),
      ["---", "lervo:", "  document: invalid", "---", "# Legacy finding", ""].join("\n"),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    for (const path of [
      "docs/archive/purple-zebra.md",
      "docs/inherited/legacy/knowledge/finding.md",
    ]) {
      expect(plan.moves.some((move) => move.fromPath === path)).toBe(false);
      expect(plan.blockers.some((blocker) => blocker.path === path)).toBe(false);
      expect(plan.referenceUpdates.some((update) => update.path === path)).toBe(false);
    }
  });

  it("preserves bounded topic families created beside package README entrypoints", () => {
    expect(
      classifyRepositoryDocument(
        "packages/devtools/README/quickstart.md",
        "# Quickstart\n\nRun the package locally.\n",
        defaultDecisionTaxonomy,
      ),
    ).toEqual({ kind: "not_migration_candidate" });
  });

  it("preserves exact repository role paths whose relocation policy is preserve", () => {
    const taxonomy: DecisionTaxonomy = {
      ...defaultDecisionTaxonomy,
      documentPolicy: {
        ...defaultDecisionTaxonomy.documentPolicy,
        roles: [
          ...defaultDecisionTaxonomy.documentPolicy.roles,
          {
            roleId: "current_status",
            scopePath: ".",
            path: "docs/STATUS.md",
            cardinality: "one",
            lifecycleOwner: "user",
            relocation: "preserve",
            rewritePolicy: "repository_tool",
            required: false,
          },
        ],
      },
    };

    expect(classifyRepositoryDocument("docs/STATUS.md", "# Current status\n", taxonomy)).toEqual({
      kind: "not_migration_candidate",
    });
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
    await recordSemanticRoutes(root, [
      { path: "apps/hub/DISTRIBUTION_GUIDE.md", routeId: "delivery" },
      { path: "apps/node/DISTRIBUTION_GUIDE.md", routeId: "delivery" },
    ]);

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
    await recordSemanticRoutes(root, [
      { path: ".claude/rules/api.md", subject: "instruction", routeId: "architecture" },
    ]);

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
    expect(agents).toContain("lervo knowledge query");
    expect(agents).not.toContain("`apps/api/**/*.{ts,tsx}`");
    expect(agents).not.toContain("docs/instructions/architecture/api.md");
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
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain("lervo knowledge query");
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).status).toBe(
      "current",
    );
  });

  it("migrates enumerated and promoted AGENTS routes to one fixed-size registry bootstrap", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/instructions/repository"), { recursive: true });
    await writeFile(
      resolve(root, "docs/instructions/repository/commit-messages.md"),
      "# Commit messages\n\nUse Conventional Commits.\n",
    );
    await writeFile(
      resolve(root, "AGENTS.md"),
      [
        "# Repository instructions",
        "",
        "Keep this user-owned preface.",
        "",
        "<!-- lervo:begin block=repository_instruction_routes schema=1 -->",
        "## Repository instruction routes",
        "",
        "- For all repository work, read [commit-messages](docs/instructions/repository/commit-messages.md).",
        "<!-- lervo:end block=repository_instruction_routes -->",
        "",
        "<!-- lervo:begin block=development_pattern_routes schema=1 -->",
        "## Promoted development patterns",
        "",
        "- [Commit messages](docs/instructions/repository/commit-messages.md)",
        "<!-- lervo:end block=development_pattern_routes -->",
        "",
      ].join("\n"),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: "AGENTS.md", ownership: "managed_blocks" }),
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

    const agents = await readFile(resolve(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("Keep this user-owned preface.");
    expect(agents).toContain("block=repository_instruction_routes schema=2");
    expect(agents).toContain("lervo knowledge query");
    expect(agents).not.toContain("development_pattern_routes");
    expect(agents).not.toContain("commit-messages.md");
    expect(Buffer.byteLength(agents)).toBeLessThan(4 * 1024);
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).status).toBe(
      "current",
    );
  });

  it("collapses duplicate legacy and current AGENTS route blocks to one bootstrap", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, "AGENTS.md"),
      [
        "# Repository instructions",
        "",
        "Keep this user-owned preface.",
        "",
        "<!-- lervo:begin block=repository_instruction_routes schema=2 -->",
        "## Repository instruction bootstrap",
        "",
        "- Already migrated.",
        "<!-- lervo:end block=repository_instruction_routes -->",
        "",
        "<!-- lervo:begin block=repository_instruction_routes schema=1 -->",
        "## Repository instruction routes",
        "",
        "- A stale CLI appended this block.",
        "<!-- lervo:end block=repository_instruction_routes -->",
        "",
      ].join("\n"),
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: "AGENTS.md", ownership: "managed_blocks" }),
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

    const agents = await readFile(resolve(root, "AGENTS.md"), "utf8");
    expect(agents.match(/lervo:begin block=repository_instruction_routes/gu)).toHaveLength(1);
    expect(agents).toContain("block=repository_instruction_routes schema=2");
    expect(agents).toContain("Keep this user-owned preface.");
    expect(agents).not.toContain("A stale CLI appended this block.");
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
    await recordSemanticRoutes(root, [
      { path: "docs/adr/0001-security.md", subject: "decision", routeId: "security" },
      { path: "docs/adr/0002-database.md", subject: "decision", routeId: "data" },
      { path: "docs/adr/0003-architecture.md", subject: "decision", routeId: "architecture" },
    ]);
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

  it("defers an unclassified flat ADR instead of blocking or falling back to foundation", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/adr"), { recursive: true });
    await writeFile(
      resolve(root, "docs/adr/0004-zebra.md"),
      "# ADR-0004: Purple zebra quorum\n\nDecision.\n",
    );

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.status).not.toBe("blocked");
    expect(plan.blockers).toEqual([]);
    expect(plan.moves.some((move) => move.fromPath.endsWith("0004-zebra.md"))).toBe(false);
    expect(plan.deferredDocuments).toEqual([
      expect.objectContaining({
        subject: "decision",
        path: "docs/adr/0004-zebra.md",
        reason: "semantic_classification_pending",
      }),
    ]);
    const lint = await lintRepositoryKnowledge(root);
    expect(lint.issues).toContainEqual(
      expect.objectContaining({
        code: "ungrouped_decision_document",
        severity: "warning",
        path: "docs/adr/0004-zebra.md",
      }),
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
    });
    expect(move).not.toHaveProperty("semanticClassification");
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
    const unclassified = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    // The legacy title term "public api" matches the heading, yet it no longer places anything.
    expect(unclassified.moves.some((move) => move.fromPath === "records/adr/0006-api.md")).toBe(
      false,
    );
    expect(unclassified.deferredDocuments).toContainEqual(
      expect.objectContaining({ path: "records/adr/0006-api.md" }),
    );
    expect(unclassified.operations).toContainEqual(
      expect.objectContaining({
        path: ".lervo/knowledge/document-layout.yaml",
        reason: "upgrade_document_policy",
      }),
    );
    await recordSemanticRoutes(root, [
      { path: "records/adr/0006-api.md", subject: "decision", routeId: "platform.api" },
    ]);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: "records/adr/0006-api.md",
        toPath: "records/decisions/platform/api/0006-api.md",
        routeId: "platform.api",
        classificationBasis: "semantic_provider",
      }),
    );
  });

  it("rewrites legacy title-term routes as prose route descriptions", async () => {
    const root = await repository();
    const legacy = (
      await readFile(resolve(root, ".lervo/knowledge/document-layout.yaml"), "utf8")
    ).replace(
      "    description: Data models, schemas, storage, persistence, and data migration.\n",
      "    minimumTitleTermMatches: 1\n    titleTerms:\n      - database\n      - schema\n",
    );
    expect(legacy).toContain("titleTerms:");
    await writeFile(resolve(root, ".lervo/knowledge/document-layout.yaml"), legacy);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    const operation = plan.operations.find(
      (item) => item.path === ".lervo/knowledge/document-layout.yaml",
    );

    expect(operation).toMatchObject({ action: "update", reason: "describe_semantic_routes" });
    expect(operation && "content" in operation ? operation.content : "").not.toContain(
      "titleTerms",
    );
    expect(operation && "content" in operation ? operation.content : "").toContain(
      'description: "Scope carried from the legacy title terms: database; schema."',
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
    await recordSemanticRoutes(root, [
      { path: currentPath, subject: "decision", routeId: "operations" },
    ]);

    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({
        fromPath: currentPath,
        toPath: "docs/decisions/operations/0008-doctor.md",
        routeId: "operations",
        classificationBasis: "semantic_provider",
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
    const deferred = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    expect(deferred.blockers).toEqual([]);
    expect(deferred.deferredDocuments).toContainEqual(
      expect.objectContaining({ subject: "decision", path: currentPath }),
    );
    await recordSemanticRoutes(root, [
      { path: currentPath, subject: "decision", routeId: "operations.trace" },
    ]);

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

  it("keeps rewrite ownership neutral without projecting tracked formatter configuration", async () => {
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

    expect(plan.status).toBe("current");
    expect(plan.operations).not.toContainEqual(
      expect.objectContaining({ path: ".prettierignore" }),
    );
    const rewrite = await inspectRepositoryDocumentRewriters({ repositoryRoot: root });
    expect(rewrite.ownership).toContainEqual({
      path: "README.md",
      owner: "reviewer",
      rewritePolicy: "reviewed_exact",
    });
    await expect(access(resolve(root, ".prettierignore"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
