import { beforeEach, expect, it, vi } from "vitest";
import { defaultDecisionTaxonomy } from "@lervo/project";
import {
  createDocumentRouteClassificationRequest,
  documentRouteClassificationContract,
  sha256,
} from "@lervo/repository-knowledge";

import { candidateReviewContract } from "../src/candidate-review-contract.js";
import { canonicalAssessmentContract } from "../src/canonical-assessment-contract.js";
import { parseCanonicalReview } from "../src/canonical-review-contract.js";
import type { CanonicalBatch } from "../src/canonical-review.js";
import { lifecyclePlanReviewVerdict } from "../src/lifecycle-plan-review-input.js";

/**
 * ADR-0604: every review stage passes its own parser as `accept`. These cases run each stage's
 * parser through the real provider call: a garbled answer is never cached as a verdict, while a
 * well-formed rejection is a verdict and is cached.
 */
const answers: unknown[] = [];
const cache = new Map<string, unknown>();

vi.mock("../src/background-provider.js", () => ({
  admittedBackgroundContext: async (context: unknown) => context,
  backgroundProviderOptions: () => ({}),
}));
vi.mock("../src/provider-admission.js", () => ({
  acquireKnowledgeProviderAdmission: async () => ({
    observationHash: "sha256:admission",
    release: async () => undefined,
  }),
}));
vi.mock("../src/provider-budget.js", () => ({
  reserveConvergenceProviderCall: async () => undefined,
}));
vi.mock("../src/upgrade-preemption.js", () => ({
  upgradeWaiting: async () => false,
  upgradePreemptionError: () => new Error("upgrade"),
  abandonProviderCallOnUpgrade: () => async () => undefined,
}));
vi.mock("../src/knowledge-worker-measurement.js", () => ({
  recordKnowledgeWorkerMeasurement: async () => undefined,
}));
vi.mock("../src/provider-review-cache.js", () => ({
  readProviderReviewCache: async ({ key }: { key: string }) => cache.get(key) ?? null,
  storeProviderReviewCache: async ({ key, value }: { key: string; value: unknown }) => {
    cache.set(key, value);
  },
}));
vi.mock("@lervo/repository-knowledge-compiler", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: async () => ({
    resolveObserved: async () => ({ value: answers.shift(), usage: { inputTokens: 1 } }),
  }),
}));

const { reviewKnowledgeJson } = await import("../src/provider-call.js");

beforeEach(() => {
  answers.length = 0;
  cache.clear();
});

/** Whether the provider call kept `answer` for a replay under the stage's parser. */
async function cached(accept: (value: unknown) => unknown, answer: unknown): Promise<boolean> {
  cache.clear();
  answers.push(answer);
  await reviewKnowledgeJson({
    context: {
      storage: {
        paths: { repositoryRoot: "/repository" },
        artifacts: { put: async () => ({ contentHash: "sha256:observation" }) },
        events: {},
      },
      provider: "codex",
      signal: new AbortController().signal,
      assertSourceCurrent: () => undefined,
      assertSourceExact: () => undefined,
    },
    state: {
      obligationId: "kconv_cache",
      snapshotHash: "sha256:snapshot",
      baseline: { delegationHash: "sha256:delegation" },
      stageData: {},
    },
    authority: {
      assertCurrent: async () => undefined,
      assignment: { assignmentId: "asn_cache" },
      agent: { agentId: "agt_reviewer" },
    },
    budget: { batchId: "batch", maximumCalls: 4 },
    prompt: "Review.",
    task: "review",
    schema: { type: "object" },
    untrustedSourceData: {},
    contextDocuments: [],
    accept,
  } as unknown as Parameters<typeof reviewKnowledgeJson>[0]);
  return cache.size > 0;
}

const rationale =
  "The exact supplied material preserves every requirement, example, link and user-owned region, so the decision is grounded in the bytes shown.";

it("lifecycle plan review: a malformed answer is not a cached rejection", async () => {
  expect(await cached(lifecyclePlanReviewVerdict, { decision: "reject", rationale })).toBe(true);
  expect(await cached(lifecyclePlanReviewVerdict, { decision: "aprove", rationale })).toBe(false);
  expect(await cached(lifecyclePlanReviewVerdict, { decision: "approve", rationale: "ok" })).toBe(
    false,
  );
  expect(await cached(lifecyclePlanReviewVerdict, null)).toBe(false);
});

it("canonical review: only a well-formed verdict is cached", async () => {
  const source = { path: "src/a.ts", contentHash: sha256("a"), kind: "text" as const };
  const batch = {
    sources: [source],
    assessment: { decisions: [], drafts: [{ path: "docs/a.md", beforeHash: null, content: "a" }] },
  } as unknown as CanonicalBatch;
  const accept = (value: unknown) => parseCanonicalReview(value, batch);
  expect(await cached(accept, { decision: "reject", rationale })).toBe(true);
  expect(await cached(accept, { decision: "approved", rationale })).toBe(false);
  // Lervo binds the exact hashes; the reviewer copies none.
  expect(parseCanonicalReview({ decision: "approve", rationale }, batch)).toMatchObject({
    sourceHashes: [source.contentHash],
    draftHashes: [sha256("a")],
  });
});

it("canonical assessment: a garbled source citation is not cached", async () => {
  const sources = [
    { path: "src/a.ts", contentHash: sha256("a"), kind: "text" as const, content: "a" },
    { path: "src/b.ts", contentHash: sha256("b"), kind: "text" as const, content: "b" },
  ];
  const { parse } = canonicalAssessmentContract({ sources, context: [], capturedSources: sources });
  const decision = (source: string, sourcePath: string) => ({
    source,
    sourcePath,
    disposition: "no_change",
    rationale,
    canonicalReferences: [],
  });
  const good = [decision("s1", "src/a.ts"), decision("s2", "src/b.ts")];
  expect(await cached(parse, { decisions: good, drafts: [] })).toBe(true);
  const mispaired = [decision("s1", "src/b.ts"), decision("s2", "src/a.ts")];
  expect(await cached(parse, { decisions: mispaired, drafts: [] })).toBe(false);
});

it("candidate resolution: a garbled candidate reference is not cached", async () => {
  const candidate = {
    candidateId: "kcanon_1234567890abcdef12345678",
    contentHash: sha256("candidate"),
    observedState: "candidate" as const,
    sourceBindings: [
      {
        path: "src/a.ts",
        beforeHash: sha256("before"),
        afterHash: sha256("after"),
        responsibility: "architecture_or_specification" as const,
      },
    ],
  };
  const { parse } = candidateReviewContract({ candidates: [candidate], documents: [] });
  const answer = (reference: string) => ({
    decisions: [
      {
        candidate: reference,
        sourcePath: "src/a.ts",
        decision: "defer",
        rationale,
        target: null,
        targetPath: null,
        targetQuote: null,
      },
    ],
  });
  expect(await cached(parse, answer("k1"))).toBe(true);
  expect(await cached(parse, answer("k7"))).toBe(false);
});

it("route classification: a mispaired answer is not cached as `uncertain`", async () => {
  const { request } = createDocumentRouteClassificationRequest({
    taxonomy: defaultDecisionTaxonomy,
    documents: ["notes/a.md", "notes/b.md"].map((path) => ({
      subject: "document" as const,
      path,
      contentHash: sha256(path),
      workspacePackage: null,
      content: `# ${path}\n`,
    })),
  });
  const { parse } = documentRouteClassificationContract(request);
  const entry = (document: string, sourcePath: string) => ({
    document,
    sourcePath,
    outcome: "uncertain",
    routeId: null,
    roleId: null,
    rationale: "No single configured route clearly fits this document.",
  });
  expect(
    await cached(parse, {
      classifications: [entry("d1", "notes/a.md"), entry("d2", "notes/b.md")],
    }),
  ).toBe(true);
  expect(
    await cached(parse, {
      classifications: [entry("d1", "notes/b.md"), entry("d2", "notes/a.md")],
    }),
  ).toBe(false);
});
