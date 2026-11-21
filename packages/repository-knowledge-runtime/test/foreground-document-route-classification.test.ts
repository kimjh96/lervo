import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  createRepositoryLayoutMigrationPlan,
  loadDocumentRouteClassifications,
  loadDocumentRouteClassificationViolations,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it, vi } from "vitest";

import { classifyForegroundDocumentRoutes } from "../src/foreground-document-route-classification.js";

const answer = vi.hoisted(() => ({ mispaired: true }));
vi.mock("@lervo/repository-knowledge-compiler", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: async () => ({
    resolve: async () => null,
    resolveObserved: async (request: {
      untrustedSourceData: { documents: { document: string; path: string }[] };
    }) => {
      const documents = request.untrustedSourceData.documents;
      return {
        value: {
          classifications: documents.map((document, index) => ({
            document: document.document,
            // A valid reference paired with another document's path breaks the contract.
            sourcePath: answer.mispaired
              ? documents[(index + 1) % documents.length]!.path
              : document.path,
            outcome: "uncertain",
            routeId: null,
            roleId: null,
            rationale: "No configured route clearly states this document's subject.",
          })),
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  }),
}));
vi.mock("../src/provider-admission.js", () => ({
  acquireKnowledgeProviderAdmission: async () => ({
    observationHash: `sha256:${"a".repeat(64)}`,
    release: async () => undefined,
  }),
  pauseKnowledgeProvider: async () => undefined,
}));

const roots: string[] = [];
afterEach(async () => {
  answer.mispaired = true;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("counts a broken foreground answer as a violation and records no verdict (ADR-0604)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-foreground-route-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_foreground_route" }));
  await mkdir(resolve(root, "notes"), { recursive: true });
  await writeFile(resolve(root, "notes/a.md"), "# Purple zebra quorum\n\nNotes.\n");
  await writeFile(resolve(root, "notes/b.md"), "# Other\n\nMore notes.\n");
  const storage = {
    paths: { repositoryRoot: root },
    artifacts: { put: async () => ({ contentHash: `sha256:${"b".repeat(64)}` }) },
  } as unknown as ProjectStorage;
  const layout = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(await classifyForegroundDocumentRoutes({ storage, layout, provider: "codex" })).toEqual({
    recorded: 0,
    providerAvailable: true,
  });
  expect([...(await loadDocumentRouteClassifications(root)).values()]).toEqual([]);
  expect(
    [...(await loadDocumentRouteClassificationViolations(root)).values()].map((item) => [
      item.path,
      item.count,
    ]),
  ).toEqual([
    ["notes/a.md", 1],
    ["notes/b.md", 1],
  ]);
  const after = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  expect(after.deferredDocuments.map((item) => item.resolution)).toEqual([
    "classification_invalid",
    "classification_invalid",
  ]);
  answer.mispaired = false;
  expect(
    await classifyForegroundDocumentRoutes({ storage, layout: after, provider: "codex" }),
  ).toEqual({ recorded: 2, providerAvailable: true });
});
