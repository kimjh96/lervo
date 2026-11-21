import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { applyInitPlan, createInitPlan, loadDecisionTaxonomy } from "@lervo/project";
import {
  createDocumentRouteClassificationRequest,
  createRepositoryLayoutMigrationPlan,
  recordDocumentRouteClassificationViolation,
  sha256,
} from "@lervo/repository-knowledge";

import { documentRouteDeferralAdvisories } from "../src/document-route-deferral-attention.js";
import { inspectTerminalRepositoryKnowledge } from "../src/terminal-knowledge-lifecycle-inspection.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("raises a broken classifier answer as named route attention (ADR-0604)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-route-attention-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_route_attention" }));
  await mkdir(resolve(root, "notes"), { recursive: true });
  const content = "# Purple zebra quorum\n\nNotes.\n";
  await writeFile(resolve(root, "notes/zebra.md"), content);
  await writeFile(resolve(root, "notes/other.md"), "# Other\n\nMore notes.\n");
  const before = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(before.deferredDocuments.map((item) => item.resolution)).not.toContain(
    "classification_invalid",
  );
  const { request, requestDigest } = createDocumentRouteClassificationRequest({
    taxonomy: await loadDecisionTaxonomy(root),
    documents: [
      {
        subject: "document",
        path: "notes/zebra.md",
        contentHash: sha256(content),
        workspacePackage: null,
        content,
      },
    ],
  });
  await recordDocumentRouteClassificationViolation({
    repositoryRoot: root,
    request,
    requestDigest,
    liveClassificationIds: new Set(before.semanticClassificationIds),
    observedAt: new Date(),
  });
  const after = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(after.deferredDocuments.map((item) => [item.path, item.resolution])).toEqual([
    ["notes/other.md", expect.not.stringMatching(/^classification_invalid$/u)],
    ["notes/zebra.md", "classification_invalid"],
  ]);
  // The broken answer is named first, with its own code, ahead of plain deferrals.
  expect(documentRouteDeferralAdvisories(after.deferredDocuments)[0]).toEqual({
    code: "document_route_classification_invalid",
    detail: "notes/zebra.md: semantic_classification_pending (classification_invalid)",
    command: expect.stringContaining("broke its review contract"),
  });
  const knowledge = await inspectTerminalRepositoryKnowledge({
    root,
    repositoryRevision: "unrecorded",
    supplementalSources: [],
  });
  expect(knowledge.advisories.map((item) => item.code)).toEqual(
    expect.arrayContaining([
      "document_route_classification_invalid",
      "document_route_classification_deferred",
    ]),
  );
});
