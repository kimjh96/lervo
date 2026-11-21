import { afterEach, expect, it, vi } from "vitest";
import { createNoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";
import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { acquireKnowledgeProviderAdmission } from "../src/provider-admission.js";
import { reserveConvergenceProviderCall } from "../src/provider-budget.js";
import { KnowledgeConvergenceRuntimeError } from "../src/failure.js";
import { reviewKnowledgeJson, withKnowledgeProviderAdmission } from "../src/provider-call.js";
import type { ConvergenceAssignmentAuthority } from "../src/workforce.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { providerOutputSchema } from "@lervo/schemas";

vi.mock("@lervo/repository-knowledge-compiler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: vi.fn(),
}));
vi.mock("../src/background-provider.js", () => ({
  admittedBackgroundContext: async (context: unknown) => context,
  backgroundProviderOptions: () => ({}),
}));
vi.mock("../src/provider-review-cache.js", () => ({
  readProviderReviewCache: async () => null,
  storeProviderReviewCache: async () => {},
}));
vi.mock("../src/provider-admission.js", () => ({ acquireKnowledgeProviderAdmission: vi.fn() }));
vi.mock("../src/provider-budget.js", () => ({ reserveConvergenceProviderCall: vi.fn() }));
vi.mock("../src/knowledge-worker-measurement.js", () => ({
  recordKnowledgeWorkerMeasurement: async () => {},
}));

afterEach(() => {
  vi.useRealTimers();
});

const state = {
  obligationId: "kconv_provider_abort",
  snapshotHash: sha256("source"),
  baseline: { policyHash: sha256("policy"), delegationHash: sha256("delegation") },
  stageData: {},
  receipts: [],
} as unknown as KnowledgeConvergenceInput;

it.each([
  ["source", "source_bytes_changed"],
  ["delegation", "knowledge_authority_unavailable"],
] as const)(
  "aborts the provider runner's signal when the %s changes mid-call and rejects with the drift",
  async (kind, code) => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    vi.mocked(acquireKnowledgeProviderAdmission).mockResolvedValue({
      observationHash: sha256("admission"),
      release,
    });
    let runnerSignal: AbortSignal | null = null;
    // The provider process answers after five seconds unless the signal it was given cancels it.
    vi.mocked(createNoCapabilityProviderJsonRunner).mockResolvedValue({
      resolveObserved: (_request: unknown, signal: AbortSignal) => {
        runnerSignal = signal;
        return new Promise((resolveAnswer, rejectAnswer) => {
          const answer = setTimeout(
            () => resolveAnswer({ value: { stale: true }, usage: { fixture: true } }),
            5_000,
          );
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(answer);
              rejectAnswer(new Error("The provider process was cancelled."));
            },
            { once: true },
          );
        });
      },
    } as unknown as Awaited<ReturnType<typeof createNoCapabilityProviderJsonRunner>>);
    const drift = new KnowledgeConvergenceRuntimeError(code);
    let drifted = false;
    const context = {
      storage: { paths: { repositoryRoot: "/repository" }, events: {}, artifacts: {} },
      provider: "claude",
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      assertSourceExact: () => {},
      assertSourceCurrent: () => {
        if (kind === "source" && drifted) throw drift;
      },
    } as unknown as ConvergenceRuntimeContext;
    const authority = {
      assignment: { assignmentId: "asn_provider_abort" },
      agent: { agentId: "agt_provider_abort" },
      assertCurrent: async () => {
        if (kind === "delegation" && drifted) throw drift;
      },
    } as unknown as ConvergenceAssignmentAuthority;
    const outcome = reviewKnowledgeJson({
      context,
      state,
      authority,
      budget: { batchId: "batch", maximumCalls: 3 },
      prompt: "Review the exact sources.",
      task: "canonical_baseline_assessment",
      schema: providerOutputSchema({}),
      untrustedSourceData: {},
      contextDocuments: [],
      // ADR-0604: these calls are aborted; any answer would be accepted as it is.
      accept: (value: unknown) => value,
    }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(runnerSignal).not.toBeNull();
    expect(runnerSignal!.aborted).toBe(false);
    drifted = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runnerSignal!.aborted).toBe(true);
    expect(await outcome).toEqual({ error: drift });
    expect(release).toHaveBeenCalledOnce();
  },
);

it("ends the source poll, including one in flight, before the exact fence and its effects", async () => {
  vi.useFakeTimers();
  vi.mocked(acquireKnowledgeProviderAdmission).mockResolvedValue({
    observationHash: sha256("admission"),
    release: async () => {},
  });
  // Authority checks take 300 ms until the answer arrives. The answer lands while the first
  // poll still waits on its authority check, so that poll's source check would follow it.
  let answered = false;
  vi.mocked(createNoCapabilityProviderJsonRunner).mockResolvedValue({
    resolveObserved: () =>
      new Promise((resolveAnswer) =>
        setTimeout(() => {
          answered = true;
          resolveAnswer({ value: { ok: true }, usage: { fixture: true } });
        }, 800),
      ),
  } as unknown as Awaited<ReturnType<typeof createNoCapabilityProviderJsonRunner>>);
  const checks: string[] = [];
  const context = {
    storage: {
      paths: { repositoryRoot: "/repository" },
      events: {},
      // The observation artifact is slow to write, as on a loaded disk.
      artifacts: {
        put: () =>
          new Promise((resolvePut) =>
            setTimeout(() => {
              checks.push("effect");
              resolvePut({ contentHash: sha256("observation") });
            }, 5_000),
          ),
      },
    },
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSourceExact: () => checks.push("exact"),
    assertSourceCurrent: () => checks.push("current"),
  } as unknown as ConvergenceRuntimeContext;
  const authority = {
    assignment: { assignmentId: "asn_provider_poll" },
    agent: { agentId: "agt_provider_poll" },
    assertCurrent: () =>
      answered
        ? Promise.resolve()
        : new Promise<void>((resolveCheck) => setTimeout(resolveCheck, 300)),
  } as unknown as ConvergenceAssignmentAuthority;
  const outcome = reviewKnowledgeJson({
    context,
    state,
    authority,
    budget: { batchId: "batch", maximumCalls: 3 },
    prompt: "Review the exact sources.",
    task: "canonical_baseline_assessment",
    schema: providerOutputSchema({}),
    untrustedSourceData: {},
    contextDocuments: [],
    accept: (value: unknown) => value,
  });
  await vi.advanceTimersByTimeAsync(12_000);
  await outcome;
  const exact = checks.indexOf("exact");
  expect(exact).toBeGreaterThan(-1);
  // No decision check may land between the exact fence and the effects it guards.
  expect(checks.slice(exact)).toEqual(["exact", "effect"]);
});

it("returns from provider admission only after a poll in flight, before the caller's fence", async () => {
  vi.useFakeTimers();
  vi.mocked(acquireKnowledgeProviderAdmission).mockResolvedValue({
    observationHash: sha256("admission"),
    release: async () => {},
  });
  // As normalization generation does: the run is only the provider call, and the caller fences
  // and writes after the wrapper returns. The answer lands while a poll waits on authority.
  let answered = false;
  const checks: string[] = [];
  const context = {
    storage: { paths: { repositoryRoot: "/repository" }, events: {}, artifacts: {} },
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSourceExact: () => checks.push("exact"),
    assertSourceCurrent: () => checks.push("current"),
  } as unknown as ConvergenceRuntimeContext;
  const authority = {
    assertCurrent: () =>
      answered
        ? Promise.resolve()
        : new Promise<void>((resolveCheck) => setTimeout(resolveCheck, 300)),
  } as unknown as ConvergenceAssignmentAuthority;
  const caller = (async () => {
    await withKnowledgeProviderAdmission({
      context,
      state,
      authority,
      budget: { batchId: "batch", maximumCalls: 3 },
      run: () =>
        new Promise((resolveAnswer) =>
          setTimeout(() => {
            answered = true;
            resolveAnswer(undefined);
          }, 800),
        ),
    });
    context.assertSourceExact(state);
    await new Promise((resolveWrite) => setTimeout(resolveWrite, 500));
    checks.push("effect");
  })();
  await vi.advanceTimersByTimeAsync(5_000);
  await caller;
  expect(checks.slice(checks.indexOf("exact"))).toEqual(["exact", "effect"]);
});

it("abandons a convergence provider call once an upgrade waits and discards its answer (ADR-0587)", async () => {
  vi.useFakeTimers();
  const release = vi.fn(async () => {});
  vi.mocked(acquireKnowledgeProviderAdmission).mockResolvedValue({
    observationHash: sha256("admission"),
    release,
  });
  let runnerSignal: AbortSignal | null = null;
  // As a normalization call that runs to its 10-minute timeout unless its signal cancels it.
  vi.mocked(createNoCapabilityProviderJsonRunner).mockResolvedValue({
    resolveObserved: (_request: unknown, signal: AbortSignal) => {
      runnerSignal = signal;
      return new Promise((resolveAnswer, rejectAnswer) => {
        const answer = setTimeout(
          () => resolveAnswer({ value: { late: true }, usage: { fixture: true } }),
          600_000,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(answer);
            rejectAnswer(new Error("The provider process was cancelled."));
          },
          { once: true },
        );
      });
    },
  } as unknown as Awaited<ReturnType<typeof createNoCapabilityProviderJsonRunner>>);
  const put = vi.fn();
  let upgradeWaiting = false;
  const context = {
    storage: { paths: { repositoryRoot: "/repository" }, events: {}, artifacts: { put } },
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSourceExact: () => {},
    assertSourceCurrent: () => {},
    yieldToUpgrade: async () => upgradeWaiting,
  } as unknown as ConvergenceRuntimeContext;
  const authority = {
    assignment: { assignmentId: "asn_upgrade_preemption" },
    agent: { agentId: "agt_upgrade_preemption" },
    assertCurrent: async () => {},
  } as unknown as ConvergenceAssignmentAuthority;
  const outcome = reviewKnowledgeJson({
    context,
    state,
    authority,
    budget: { batchId: "batch", maximumCalls: 3 },
    prompt: "Review the exact sources.",
    task: "canonical_baseline_assessment",
    schema: providerOutputSchema({}),
    untrustedSourceData: {},
    contextDocuments: [],
    accept: (value: unknown) => value,
  }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(5_000);
  expect(runnerSignal).not.toBeNull();
  expect(runnerSignal!.aborted).toBe(false);
  upgradeWaiting = true;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(runnerSignal!.aborted).toBe(true);
  const settled = await outcome;
  expect(settled).toMatchObject({ error: { code: "knowledge_capacity_unavailable" } });
  // The answer is discarded: no observation artifact and no stage effect follow the call.
  expect(put).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it("starts no provider call and spends no budget while an upgrade already waits (ADR-0587)", async () => {
  const release = vi.fn(async () => {});
  vi.mocked(acquireKnowledgeProviderAdmission).mockResolvedValue({
    observationHash: sha256("admission"),
    release,
  });
  vi.mocked(reserveConvergenceProviderCall).mockClear();
  const providerQuantum = { remaining: 1 };
  const context = {
    storage: { paths: { repositoryRoot: "/repository" }, events: {}, artifacts: {} },
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSourceExact: () => {},
    assertSourceCurrent: () => {},
    providerQuantum,
    yieldToUpgrade: async () => true,
  } as unknown as ConvergenceRuntimeContext;
  const run = vi.fn(async () => "answer");
  await expect(
    withKnowledgeProviderAdmission({
      context,
      state,
      authority: { assertCurrent: async () => {} } as unknown as ConvergenceAssignmentAuthority,
      budget: { batchId: "batch", maximumCalls: 3 },
      run,
    }),
  ).rejects.toMatchObject({ code: "knowledge_capacity_unavailable" });
  expect(run).not.toHaveBeenCalled();
  expect(reserveConvergenceProviderCall).not.toHaveBeenCalled();
  expect(providerQuantum.remaining).toBe(1);
  expect(release).toHaveBeenCalledOnce();
});
