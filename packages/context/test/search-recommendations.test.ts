import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  LexicalSearchIndex,
} from "@lervo/search";
import type { DocumentRegistry, RoleProfile } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { prepareContext } from "../src/index.js";

const roots: string[] = [];
const projectId = "prj_search_context_01";
const policyVersion = `sha256:${"a".repeat(64)}`;

function hash(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function receiptFactory(): () => string {
  let sequence = 0;
  return () => `ctx_search_${String(++sequence).padStart(8, "0")}`;
}

const role: RoleProfile = {
  schemaVersion: 1,
  roleId: "developer",
  name: "Developer",
  description: "Search recommendation boundary fixture",
  requestTypes: ["implementation"],
  requiredInputs: [],
  contextPolicy: {
    requiredDocumentRuleIds: ["repository.instructions"],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow",
    "filesystem.write": "allow",
    "shell.execute": "allow",
    "network.access": "deny",
    "external.message": "deny",
    deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "fixture",
    schemaRef: "lervo-schema://fixture/output/v1",
    pathTemplate: "artifacts/{runId}.md",
    citationsRequired: true,
    presentation: { audience: "human", locale: "ko-KR", writingPolicyId: "writing.fixture" },
  },
  verification: { suiteIds: ["fixture.default"], failureDisposition: "fail_run" },
  handoff: { allowedRoleIds: [], evidenceLinksRequired: true, sharedContextRequired: true },
};

function record(path: string) {
  return {
    path,
    kind: "canonical" as const,
    responsibleParty: { kind: "team" as const, id: "platform" },
    connectedPaths: ["unrelated/**"],
    verifiedRevision: "fixture-v1",
    verifiedAt: "2026-08-20T00:00:00Z",
    reviewIntervalDays: 30,
    ownership: { mode: "user" as const },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("search recommendations in context preparation", () => {
  it("keeps recommendations distinct and rejects a stale selected source", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-context-search-"));
    roots.push(root);
    await mkdir(resolve(root, "docs"));
    const selectedText = "# Search recommendation document\n\nDeployment recovery procedure.\n";
    const observedText = "# Reference document\n\nA search recommendation candidate that was not selected.\n";
    await Promise.all([
      writeFile(resolve(root, "AGENTS.md"), "Repository instructions.\n"),
      writeFile(resolve(root, "docs/search-selected.md"), selectedText),
      writeFile(resolve(root, "docs/search-observed.md"), observedText),
    ]);
    const registry: DocumentRegistry = {
      schemaVersion: 1,
      documents: {
        doc_search_selected: record("docs/search-selected.md"),
        doc_search_observed: record("docs/search-observed.md"),
      },
    };
    const response = new LexicalSearchIndex(Object.entries(registry.documents).map(([id, item]) => {
      const text = id === "doc_search_selected" ? selectedText : observedText;
      return {
        kind: "document" as const,
        sourceId: id,
        path: item.path,
        contentHash: hash(text),
        title: id === "doc_search_selected" ? "Search recommendation document" : "Reference document",
        labels: [],
        text,
      };
    })).search("search recommendation");
    const batch = createSearchRecommendationBatch({
      attempt: createSearchAttempt({
        projectId,
        observedAt: new Date("2026-08-20T00:30:00Z"),
        nonce: "7".repeat(32),
        response,
      }),
      recommendationLimit: 2,
      maximumSelections: 1,
    });
    const knowledgeContext = {
      conceptId: "concept_aaaaaaaaaaaaaaaaaaaaaaaa",
      assurance: "human_reviewed" as const,
      freshness: "current" as const,
      sourceSnapshotId: "ksnap_bbbbbbbbbbbbbbbbbbbbbbbb",
      impactReportId: "kimpact_cccccccccccccccccccccccc",
    };
    const input = {
      repositoryRoot: root,
      sourceRevision: "fixture-search-v1",
      coordinates: { projectId, runId: "run_search_01", sessionId: "ses_search_01", roleId: "developer" },
      registry,
      role,
      expectedPaths: ["src/result.ts"],
      documentRules: {},
      publications: [],
      handoffs: [],
      recommendationBatches: [batch],
      additionalCandidates: [{
        documentId: "doc_search_selected",
        path: "docs/search-selected.md",
        connectedPaths: [],
        source: "knowledge" as const,
        knowledgeContext,
      }],
      policyVersion,
      recordedAt: new Date("2026-08-20T01:00:00Z"),
    } as const;
    const loaded = await prepareContext(input);

    expect(loaded.plan.evidence.filter((item) => item.state === "recommended")).toHaveLength(2);
    expect(loaded.plan.documents.find((item) => item.documentId === "doc_search_selected")?.reasons)
      .toContainEqual(expect.objectContaining({ reasonCode: "search_recommendation" }));
    expect(loaded.documents.map((document) => document.documentId)).toContain("doc_search_selected");
    expect(loaded.documents.map((document) => document.documentId)).not.toContain("doc_search_observed");
    expect(loaded.documents.find((document) => document.documentId === "doc_search_selected")?.knowledgeContext)
      .toEqual(knowledgeContext);
    expect(loaded.evidence.filter((item) => item.documentId === "doc_search_selected"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ state: "discovered", knowledgeContext }),
        expect.objectContaining({ state: "recommended", knowledgeContext }),
        expect.objectContaining({ state: "selected", knowledgeContext }),
        expect.objectContaining({ state: "loaded", knowledgeContext }),
      ]));

    const observeOnlyBatch = createSearchRecommendationBatch({
      attempt: createSearchAttempt({
        projectId,
        observedAt: new Date("2026-08-20T00:31:00Z"),
        nonce: "8".repeat(32),
        response,
      }),
      recommendationLimit: 2,
      maximumSelections: 0,
    });
    const forward = await prepareContext({
      ...input,
      recommendationBatches: [batch, observeOnlyBatch],
      createReceiptId: receiptFactory(),
    });
    const reversed = await prepareContext({
      ...input,
      recommendationBatches: [observeOnlyBatch, batch],
      createReceiptId: receiptFactory(),
    });
    expect(reversed.plan).toEqual(forward.plan);

    await writeFile(resolve(root, "docs/search-selected.md"), `${selectedText}changed\n`);
    await expect(prepareContext({ ...input, sourceRevision: "fixture-search-v2" }))
      .rejects.toMatchObject({ code: "content_hash_mismatch" });
  });
});
