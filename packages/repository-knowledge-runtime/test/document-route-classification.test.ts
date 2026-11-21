import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  createRepositoryLayoutMigrationPlan,
  DOCUMENT_ROUTE_CLASSIFICATION_TASK,
  loadDocumentRouteClassifications,
  loadDocumentRouteClassificationViolations,
  type DocumentRouteClassificationRequest,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it, vi } from "vitest";

import { classifyDeferredDocumentRoutes } from "../src/document-route-classification.js";
import { assertConvergenceSourceCurrent, assertConvergenceSourceExact } from "../src/host.js";
import { captureConvergenceSources } from "../src/source-capture.js";
import { lyingSourceObservation } from "./lying-source-observation.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";

/** The view the classifier sees (ADR-0604): documents by reference, never by content hash. */
type RouteView = Omit<DocumentRouteClassificationRequest, "documents" | "routeSetDigest"> & {
  documents: Array<{ document: string; path: string }>;
};
const providerRequests: Array<{ task: string; request: RouteView }> = [];
/** Makes the classifier answer with another document's path, as a garbled answer would. */
let mispaired = false;
/** Runs while the provider answers, as another writer would. */
let duringReview: (() => void) | null = null;
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
  reviewKnowledgeJson: async (input: {
    task: string;
    untrustedSourceData: unknown;
    accept: (value: unknown) => unknown;
  }) => {
    const request = input.untrustedSourceData as RouteView;
    providerRequests.push({ task: input.task, request });
    duringReview?.();
    const value = {
      classifications: request.documents.map((document, index) => ({
        document: document.document,
        sourcePath: mispaired
          ? request.documents[(index + 1) % request.documents.length]!.path
          : document.path,
        outcome:
          document.path.endsWith("runbook.md") || document.path === "TRACE.md"
            ? "route"
            : "uncertain",
        routeId:
          document.path.endsWith("runbook.md") || document.path === "TRACE.md"
            ? "operations"
            : null,
        roleId: null,
        rationale: "The runbook explains how operators recover the running service.",
      })),
    };
    // As the real call does: an answer the stage's contract rejects is never kept as accepted.
    let accepted = true;
    try {
      input.accept(value);
    } catch {
      accepted = false;
    }
    acceptance.push(accepted);
    return {
      value,
      usage: null,
      admissionObservationHash: "sha256:" + "a".repeat(64),
      observationArtifactHash: "sha256:" + "b".repeat(64),
    };
  },
}));
const acceptance: boolean[] = [];

const roots: string[] = [];
afterEach(async () => {
  providerRequests.length = 0;
  acceptance.length = 0;
  mispaired = false;
  assignedPaths.length = 0;
  duringReview = null;
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
});

it("classifies outside delegation roots and never queries uncertain bytes twice", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-route-classification-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_route_classification" }));
  await mkdir(resolve(root, "notes"), { recursive: true });
  await mkdir(resolve(root, "elsewhere"), { recursive: true });
  await writeFile(resolve(root, "notes/runbook.md"), "# Recovery runbook\n\nRestart steps.\n");
  await writeFile(resolve(root, "notes/zebra.md"), "# Purple zebra quorum\n\nNotes.\n");
  await writeFile(resolve(root, "TRACE.md"), "# Trace\n\nOperator tracing.\n");
  await writeFile(resolve(root, "elsewhere/outside.md"), "# Outside\n\nOut of scope.\n");
  const context = {
    storage: { paths: { repositoryRoot: root } },
    provider: "codex",
    assertSourceExact: () => {},
    assertSourceCurrent: () => {},
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
    "TRACE.md",
  ]);

  expect(await classifyDeferredDocumentRoutes(context, state, () => undefined, before)).toBe(4);
  expect(providerRequests.map((item) => item.task)).toEqual([DOCUMENT_ROUTE_CLASSIFICATION_TASK]);
  expect(assignedPaths).toEqual([
    ["elsewhere/outside.md", "notes/runbook.md", "notes/zebra.md", "TRACE.md"],
  ]);

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
  expect(after.moves).toContainEqual(
    expect.objectContaining({ fromPath: "TRACE.md", toPath: "docs/operations/TRACE.md" }),
  );
  expect(after.deferredDocuments.map((item) => [item.path, item.reason])).toEqual([
    ["elsewhere/outside.md", "semantic_classification_uncertain"],
    ["notes/zebra.md", "semantic_classification_uncertain"],
  ]);

  // Uncertain documents are never asked about again for the same bytes.
  expect(await classifyDeferredDocumentRoutes(context, state, () => undefined, after)).toBe(0);
  expect(providerRequests).toHaveLength(1);
});

it("refuses to record classifications when another writer edits during the review", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-route-classification-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_route_classification" }));
  await mkdir(resolve(root, "notes"), { recursive: true });
  await writeFile(resolve(root, "notes/runbook.md"), "# Recovery runbook\n\nRestart steps.\n");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "."],
    ["-c", "user.name=T", "-c", "user.email=t@lervo.invalid", "commit", "-qm", "fixture"],
  ])
    execFileSync("git", ["-C", root, ...args]);
  const policyHash = "sha256:policy";
  const state = {
    obligationId: "kobl_fixture",
    snapshotHash: captureConvergenceSources(root, policyHash).snapshotHash,
    stageData: {},
    baseline: { projectId: "prj_route_classification", delegationHash: null, policyHash },
  } as unknown as KnowledgeConvergenceInput;
  // Only an exact fence can notice the edit: decision checks are answered with the old capture.
  const context = {
    storage: { paths: { repositoryRoot: root } },
    provider: "codex",
    signal: new AbortController().signal,
    sourceObservation: lyingSourceObservation(root),
    assertSourceExact: (input: KnowledgeConvergenceInput) =>
      assertConvergenceSourceExact(context, input),
    assertSourceCurrent: (input: KnowledgeConvergenceInput) =>
      assertConvergenceSourceCurrent(context, input),
  } as unknown as ConvergenceRuntimeContext;
  duringReview = () => appendFileSync(resolve(root, "notes/runbook.md"), "Edited.\n");
  const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  await expect(
    classifyDeferredDocumentRoutes(context, state, () => undefined, plan),
  ).rejects.toMatchObject({ code: "source_bytes_changed" });
  expect([...(await loadDocumentRouteClassifications(root)).values()]).toEqual([]);
});

it("records nothing for a garbled answer and never keeps it as a verdict (ADR-0604)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-route-classification-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_route_classification" }));
  await mkdir(resolve(root, "notes"), { recursive: true });
  await writeFile(resolve(root, "notes/runbook.md"), "# Recovery runbook\n\nRestart steps.\n");
  await writeFile(resolve(root, "notes/zebra.md"), "# Purple zebra quorum\n\nNotes.\n");
  const context = {
    storage: { paths: { repositoryRoot: root } },
    provider: "codex",
    assertSourceExact: () => {},
    assertSourceCurrent: () => {},
  } as unknown as ConvergenceRuntimeContext;
  const state = {
    obligationId: "kobl_fixture",
    baseline: { projectId: "prj_route_classification", delegationHash: null },
  } as unknown as KnowledgeConvergenceInput;
  // Each answer cites a valid document reference with another document's path.
  mispaired = true;
  const plan = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(await classifyDeferredDocumentRoutes(context, state, () => undefined, plan)).toBe(0);
  expect(acceptance).toEqual([false]);
  expect(JSON.stringify(providerRequests[0]!.request)).not.toContain("sha256:");
  expect([...(await loadDocumentRouteClassifications(root)).values()]).toEqual([]);
  const after = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(after.deferredDocuments.map((item) => item.reason)).toEqual([
    "semantic_classification_pending",
    "semantic_classification_pending",
  ]);
  // ADR-0604: the violation is counted, so the pending documents read as named attention.
  expect(after.deferredDocuments.map((item) => item.resolution)).toEqual([
    "classification_invalid",
    "classification_invalid",
  ]);
  const violations = [...(await loadDocumentRouteClassificationViolations(root)).values()];
  expect(violations.map((item) => [item.path, item.count, item.code])).toEqual(
    expect.arrayContaining([
      ["notes/runbook.md", 1, "knowledge_semantic_review_invalid"],
      ["notes/zebra.md", 1, "knowledge_semantic_review_invalid"],
    ]),
  );
  // A repeat counts again; a later valid answer classifies the documents and ends the attention.
  expect(
    await classifyDeferredDocumentRoutes(
      context,
      { ...state, obligationId: "kobl_second" } as KnowledgeConvergenceInput,
      () => undefined,
      after,
    ),
  ).toBe(0);
  expect(
    [...(await loadDocumentRouteClassificationViolations(root)).values()].map((item) => item.count),
  ).toEqual([2, 2]);
  mispaired = false;
  expect(await classifyDeferredDocumentRoutes(context, state, () => undefined, after)).toBe(2);
  const classified = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(classified.deferredDocuments.map((item) => item.resolution)).not.toContain(
    "classification_invalid",
  );
});
