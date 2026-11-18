import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyInitPlan, createInitPlan, loadDecisionTaxonomy } from "@lervo/project";
import { afterEach, expect, it } from "vitest";
import {
  createDocumentRouteClassificationRecords,
  createDocumentRouteClassificationRequest,
  createRepositoryLayoutMigrationPlan,
  documentRouteDeferralResolution,
  interpretDocumentRouteClassificationResponse,
  readRevertedRepositoryLayoutMoves,
  recordDocumentRouteClassifications,
  recordRevertedRepositoryLayoutMoves,
  REPOSITORY_LAYOUT_REVERTS_PATH,
  sha256,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-accounting-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_document_accounting" }));
  await writeFile(resolve(root, "TRACE.md"), "# Trace\n\nOperators inspect service traces.\n");
  return root;
}

it("reports incomplete coverage and a provider resolution for a root document", async () => {
  const root = await fixture();
  const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(plan.coverage.complete).toBe(false);
  expect(plan.deferredDocumentCount).toBe(1);
  expect(plan.deferredDocuments).toEqual([
    expect.objectContaining({ path: "TRACE.md", resolution: "provider_unavailable" }),
  ]);
  expect(documentRouteDeferralResolution({})).toBe("background_classification");
});

it("defers an unclassified document to background classification whatever the roots", async () => {
  const root = await fixture();
  // ADR-0561: the resident classifies and moves a document wherever it sits.
  for (const [providerAvailable, resolution] of [
    [true, "background_classification"],
    [false, "provider_unavailable"],
  ] as const) {
    const plan = await createRepositoryLayoutMigrationPlan({
      repositoryRoot: root,
      documentRouteContext: { providerAvailable },
    });
    expect(plan.deferredDocuments[0]?.resolution).toBe(resolution);
    expect(plan.coverage.complete).toBe(false);
  }
});

it("accounts for every candidate once across moved, retained, and deferred outcomes", async () => {
  const root = await fixture();
  await writeFile(resolve(root, "PENDING.md"), "# Pending\n\nNo route yet.\n");
  await writeFile(resolve(root, "UNCERTAIN.md"), "# Uncertain\n\nUnknown purpose.\n");
  await mkdir(resolve(root, "app"));
  await writeFile(resolve(root, "app/package.json"), '{"name":"content"}');
  await writeFile(resolve(root, "app/render.ts"), "import content from './copy.md';\n");
  await writeFile(resolve(root, "app/copy.md"), "# Customer copy\n");
  const taxonomy = await loadDecisionTaxonomy(root);
  const documents = await Promise.all(
    ["TRACE.md", "UNCERTAIN.md"].map(async (path) => {
      const content = await readFile(resolve(root, path), "utf8");
      return {
        subject: "document" as const,
        path,
        contentHash: sha256(content),
        content,
        workspacePackage: null,
      };
    }),
  );
  const { request, requestDigest } = createDocumentRouteClassificationRequest({
    taxonomy,
    documents,
  });
  const value = {
    classifications: request.documents.map((document) => ({
      path: document.path,
      contentHash: document.contentHash,
      outcome: document.path === "TRACE.md" ? "route" : "uncertain",
      routeId: document.path === "TRACE.md" ? "operations" : null,
      roleId: null,
      rationale: "The service tracing procedure belongs with operator documentation.",
    })),
  };
  await recordDocumentRouteClassifications({
    repositoryRoot: root,
    records: createDocumentRouteClassificationRecords({
      request,
      requestDigest,
      verdicts: interpretDocumentRouteClassificationResponse(request, value),
      provider: "codex",
      responseDigest: sha256(JSON.stringify(value)),
      observationArtifactHash: null,
      classifiedAt: new Date(),
    }),
    liveClassificationIds: new Set<string>(),
  });
  const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  const outcomes = [
    ...plan.moves.map((move) => move.fromPath),
    ...plan.retainedDocuments.map((document) => document.path),
    ...plan.deferredDocuments.map((document) => document.path),
  ];
  expect(outcomes.sort()).toEqual(["PENDING.md", "TRACE.md", "UNCERTAIN.md", "app/copy.md"].sort());
  expect(new Set(outcomes).size).toBe(outcomes.length);
  expect(
    plan.deferredDocuments.find((document) => document.path === "UNCERTAIN.md")?.resolution,
  ).toBe("route_metadata");
  expect(plan.moves.find((move) => move.fromPath === "TRACE.md")?.toPath).toBe(
    "docs/operations/TRACE.md",
  );
});

it("keeps a document the owner reverted in place until its bytes change", async () => {
  const root = await fixture();
  const content =
    "---\nlervo:\n  document:\n    route: operations\n---\n# Trace\n\nOperator tracing.\n";
  await writeFile(resolve(root, "TRACE.md"), content);
  const planned = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  const move = planned.moves.find((item) => item.fromPath === "TRACE.md")!;
  expect(move.toPath).toBe("docs/operations/TRACE.md");
  // ADR-0561: the revert record travels in the revert commit; every host then keeps the document.
  expect(
    await recordRevertedRepositoryLayoutMoves({
      repositoryRoot: root,
      moves: [
        {
          fromPath: "TRACE.md",
          toPath: move.toPath,
          contentHash: sha256(content),
          commit: "a".repeat(40),
        },
      ],
      now: new Date("2026-11-02T00:00:00.000Z"),
    }),
  ).toBe(REPOSITORY_LAYOUT_REVERTS_PATH);
  expect(await readRevertedRepositoryLayoutMoves(root)).toHaveLength(1);
  const held = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(held.moves.some((item) => item.fromPath === "TRACE.md")).toBe(false);
  expect(held.retainedDocuments).toContainEqual({
    path: "TRACE.md",
    basis: "layout_reverted",
    evidence: { commit: "a".repeat(40), revertedAt: "2026-11-02T00:00:00.000Z" },
  });
  await writeFile(resolve(root, "TRACE.md"), `${content}\nEdited after the revert.\n`);
  const edited = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(edited.moves.some((item) => item.fromPath === "TRACE.md")).toBe(true);
});

it("reports every deferred document beyond the former 256-entry display cap", async () => {
  const root = await fixture();
  await mkdir(resolve(root, "legacy"));
  await Promise.all(
    Array.from({ length: 257 }, (_, index) =>
      writeFile(resolve(root, `legacy/note-${index}.md`), "# Note\n"),
    ),
  );
  const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(plan.deferredDocumentCount).toBe(258);
  expect(plan.deferredDocuments).toHaveLength(258);
});

it.each(["existing", "ambiguous"] as const)(
  "accounts for every source with an %s destination conflict",
  async (kind) => {
    const root = await fixture();
    const content =
      "---\nlervo:\n  document:\n    route: operations\n---\n# Trace\n\nOperator tracing.\n";
    await writeFile(resolve(root, "TRACE.md"), content);
    if (kind === "existing") {
      await mkdir(resolve(root, "docs/operations"), { recursive: true });
      await writeFile(resolve(root, "docs/operations/TRACE.md"), "# Existing trace\n");
    } else {
      await mkdir(resolve(root, "legacy"));
      await writeFile(resolve(root, "legacy/TRACE.md"), content);
    }
    const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
    const expected = kind === "existing" ? ["TRACE.md"] : ["legacy/TRACE.md", "TRACE.md"];
    const outcomes = [
      ...plan.moves.map((move) => move.fromPath),
      ...plan.retainedDocuments.map((document) => document.path),
      ...plan.deferredDocuments.map((document) => document.path),
    ];
    expect(outcomes.sort()).toEqual(expected.sort());
    expect(new Set(outcomes).size).toBe(expected.length);
    expect(plan.deferredDocumentCount).toBe(expected.length);
    expect(plan.coverage.complete).toBe(false);
    for (const path of expected)
      expect(plan.deferredDocuments).toContainEqual(
        expect.objectContaining({
          path,
          basis: "explicit_metadata",
          destination: "docs/operations/TRACE.md",
          resolution: "destination_conflict",
          reason: "destination_conflict",
        }),
      );
  },
);
