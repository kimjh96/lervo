import { beforeEach, expect, it, vi } from "vitest";

/** The provider's answers, in call order. */
const answers: unknown[] = [];
const calls = { provider: 0 };
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
    resolveObserved: async () => {
      calls.provider++;
      return { value: answers.shift(), usage: { inputTokens: 1, outputTokens: 1 } };
    },
  }),
}));

const { reviewKnowledgeJson } = await import("../src/provider-call.js");

beforeEach(() => {
  answers.length = 0;
  calls.provider = 0;
  cache.clear();
});

function input(accept: (value: unknown) => unknown) {
  return {
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
    task: "independent_normalization_review",
    schema: { type: "object" },
    untrustedSourceData: {},
    contextDocuments: [],
    accept,
  } as unknown as Parameters<typeof reviewKnowledgeJson>[0];
}

const accept = (value: unknown) => {
  if ((value as { valid?: unknown } | null)?.valid !== true) throw new Error("invalid");
  return value;
};

it("never replays an answer its contract rejects, and replays an accepted one (ADR-0604)", async () => {
  answers.push({ valid: false }, { valid: true });
  // The first answer is invalid: the caller still sees it, but it is not kept.
  await expect(reviewKnowledgeJson(input(accept))).resolves.toMatchObject({
    value: { valid: false },
  });
  expect(cache.size).toBe(0);
  // The same request asks the provider again instead of replaying the invalid answer.
  await expect(reviewKnowledgeJson(input(accept))).resolves.toMatchObject({
    value: { valid: true },
  });
  expect(calls.provider).toBe(2);
  // An accepted answer is replayed without a provider call.
  await expect(reviewKnowledgeJson(input(accept))).resolves.toMatchObject({
    value: { valid: true },
  });
  expect(calls.provider).toBe(2);
});

it("asks again for an invalid answer an earlier release cached", async () => {
  answers.push({ valid: true });
  await reviewKnowledgeJson(input(() => undefined));
  const [key] = cache.keys();
  // As before this release: an invalid answer stored under the request's key.
  cache.set(key!, {
    value: { valid: false },
    usage: {},
    admissionObservationHash: "sha256:admission",
    observationArtifactHash: "sha256:observation",
  });
  answers.push({ valid: true });
  await expect(reviewKnowledgeJson(input(accept))).resolves.toMatchObject({
    value: { valid: true },
  });
  expect(calls.provider).toBe(2);
});

it("replays an answer only for the binding it was given (ADR-0604)", async () => {
  answers.push({ valid: true }, { valid: true });
  const bound = (planHash: string) => ({ ...input(accept), binding: { planHash } });
  await reviewKnowledgeJson(bound("sha256:plan-a"));
  // The same view under another exact plan hash asks the provider again.
  await reviewKnowledgeJson(bound("sha256:plan-b"));
  expect(calls.provider).toBe(2);
  await reviewKnowledgeJson(bound("sha256:plan-a"));
  expect(calls.provider).toBe(2);
});
