import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  createRepositoryLayoutMigrationPlan,
  DOCUMENT_ROUTE_CLASSIFICATION_TASK,
  loadDocumentRouteClassifications,
  type DocumentRouteClassificationRequest,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it, vi } from "vitest";

import { classifyDeferredDocumentRoutes } from "../src/document-route-classification.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";

const providerRequests: Array<{ task: string; request: DocumentRouteClassificationRequest }> = [];
const assignedPaths: string[][] = [];

vi.mock("../src/delegation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/delegation.js")>();
  return {
    ...actual,
    assertConvergenceDelegation: async () => ({
      normalizationRoots: ["notes"],
      canonicalRoots: ["docs"],
      resourceCeilings: { maximumDocuments: 8, maximumProviderCalls: 4 },
    }),
  };
});

vi.mock("../src/workforce.js", () => ({
  withConvergenceAssignment: async (input: {
    paths: string[];
    run(authority: unknown): Promise<unknown>;
  }) => {
    assignedPaths.push(input.paths);
    return input.run({});
  },
}));

vi.mock("../src/provider-call.js", () => ({
  reviewKnowledgeJson: async (input: { task: string; untrustedSourceData: unknown }) => {
    const request = input.untrustedSourceData as DocumentRouteClassificationRequest;
    providerRequests.push({ task: input.task, request });
    return {
      value: {
        classifications: request.documents.map((document) => ({
          path: document.path,
          contentHash: document.contentHash,
          outcome: document.path.endsWith("runbook.md") ? "route" : "uncertain",
          routeId: document.path.endsWith("runbook.md") ? "operations" : null,
          roleId: null,
          rationale: "The runbook explains how operators recover the running service.",
        })),
      },
      usage: null,
      admissionObservationHash: "sha256:" + "a".repeat(64),
      observationArtifactHash: "sha256:" + "b".repeat(64),
    };
  },
}));

const roots: string[] = [];
afterEach(async () => {
  providerRequests.length = 0;
  assignedPaths.length = 0;
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
});

it("classifies in-scope deferred documents once and leaves the rest deferred", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-route-classification-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_route_classification" }));
  await mkdir(resolve(root, "notes"), { recursive: true });
  await mkdir(resolve(root, "elsewhere"), { recursive: true });
  await writeFile(resolve(root, "notes/runbook.md"), "# Recovery runbook\n\nRestart steps.\n");
  await writeFile(resolve(root, "notes/zebra.md"), "# Purple zebra quorum\n\nNotes.\n");
  await writeFile(resolve(root, "elsewhere/outside.md"), "# Outside\n\nOut of scope.\n");
  const context = {
    storage: { paths: { repositoryRoot: root } },
    provider: "codex",
  } as unknown as ConvergenceRuntimeContext;
  const state = {
    obligationId: "kobl_fixture",
    baseline: { projectId: "prj_route_classification", delegationHash: null },
  } as unknown as KnowledgeConvergenceInput;

  const before = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(before.deferredDocuments.map((item) => item.path)).toEqual([
    "elsewhere/outside.md",
    "notes/runbook.md",
    "notes/zebra.md",
  ]);

  expect(await classifyDeferredDocumentRoutes(context, state, () => undefined, before)).toBe(2);
  expect(providerRequests.map((item) => item.task)).toEqual([DOCUMENT_ROUTE_CLASSIFICATION_TASK]);
  expect(assignedPaths).toEqual([["notes/runbook.md", "notes/zebra.md"]]);

  const records = [...(await loadDocumentRouteClassifications(root)).values()];
  expect(records.map((record) => [record.path, record.outcome, record.routeId])).toEqual(
    expect.arrayContaining([
      ["notes/runbook.md", "route", "operations"],
      ["notes/zebra.md", "uncertain", null],
    ]),
  );
  expect(records[0]!.evidence).toMatchObject({
    basis: "semantic_provider",
    provider: "codex",
    adapterId: "codex/no-capability-json",
    observationArtifactHash: "sha256:" + "b".repeat(64),
  });

  const after = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(after.moves).toContainEqual(
    expect.objectContaining({
      fromPath: "notes/runbook.md",
      toPath: "docs/operations/runbook.md",
      classificationBasis: "semantic_provider",
    }),
  );
  expect(after.deferredDocuments.map((item) => [item.path, item.reason])).toEqual([
    ["elsewhere/outside.md", "semantic_classification_pending"],
    ["notes/zebra.md", "semantic_classification_uncertain"],
  ]);

  // Uncertain and out-of-scope documents are never asked about again for the same bytes.
  expect(await classifyDeferredDocumentRoutes(context, state, () => undefined, after)).toBe(0);
  expect(providerRequests).toHaveLength(1);
});
