import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordTurnMeasurement } from "@lervo/execution-contract";
import { sha256, type RepositoryKnowledgeReviewJob } from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  type KnowledgeReviewCall,
} from "@lervo/repository-knowledge-compiler";
import type { ProjectStorage } from "@lervo/project-storage";

import { governChangeReviewCalls } from "../src/change-review-host.js";
import { recordChangeReviewUsage } from "../src/change-review-usage.js";
import { freshnessCallAbandoned, generateFreshnessProposal } from "../src/freshness-generation.js";
import { acquireKnowledgeProviderAdmission } from "../src/provider-admission.js";
import { reserveConvergenceProviderCall } from "../src/provider-budget.js";

vi.mock("@lervo/repository-knowledge-compiler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: vi.fn(),
}));
vi.mock("@lervo/execution-contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/execution-contract")>()),
  createTurnMeasurement: () => ({}),
  recordTurnMeasurement: vi.fn(async () => {}),
}));
vi.mock("../src/background-provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/background-provider.js")>()),
  admittedBackgroundContext: async (context: unknown) => context,
  backgroundProviderOptions: () => ({}),
}));
vi.mock("../src/delegation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/delegation.js")>()),
  loadConvergenceDelegation: async () => ({
    contentHash: `sha256:${"0".repeat(64)}`,
    delegation: {
      state: "active",
      projectId: "prj_upgrade_preemption",
      expiresAt: "2999-01-01T00:00:00.000Z",
      providers: ["claude"],
      resourceCeilings: { maximumProviderCalls: 8 },
    },
  }),
}));
vi.mock("../src/provider-admission.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider-admission.js")>()),
  acquireKnowledgeProviderAdmission: vi.fn(),
  pauseKnowledgeProvider: vi.fn(async () => {}),
}));
vi.mock("../src/provider-budget.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider-budget.js")>()),
  reserveConvergenceProviderCall: vi.fn(async () => 1),
}));
vi.mock("../src/change-review-usage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/change-review-usage.js")>()),
  recordChangeReviewUsage: vi.fn(async () => "observed"),
}));

const release = vi.fn(async () => {});
const storage = {
  paths: { repositoryRoot: "/repository" },
  manifest: { projectId: "prj_upgrade_preemption" },
  events: {},
  artifacts: {},
} as unknown as ProjectStorage;

/** A provider process that answers after ten minutes unless the signal it was given cancels it. */
function slowCall(seen: (signal: AbortSignal) => void): KnowledgeReviewCall {
  return (signal) => {
    seen(signal);
    return new Promise((resolveAnswer, rejectAnswer) => {
      const answer = setTimeout(
        () => resolveAnswer({ value: { late: true }, usage: null }),
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
  };
}

beforeEach(() => {
  vi.mocked(acquireKnowledgeProviderAdmission).mockClear();
  vi.mocked(acquireKnowledgeProviderAdmission).mockResolvedValue({
    observationHash: sha256("admission"),
    release,
  });
  vi.mocked(reserveConvergenceProviderCall).mockClear();
  vi.mocked(recordChangeReviewUsage).mockClear();
  vi.mocked(recordTurnMeasurement).mockClear();
  release.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const freshnessContext = (yieldToUpgrade: () => Promise<boolean>) => ({
  storage,
  provider: "claude" as const,
  signal: new AbortController().signal,
  liveWorkPending: async () => false,
  now: () => new Date("2026-11-18T01:09:47.000Z"),
  providerQuantum: { remaining: 1 },
  yieldToUpgrade,
});

const freshnessSource = {
  sourceData: { document: "docs/runtime.md" },
  documents: [],
  sourceRevision: sha256("document"),
};

it("abandons a freshness call once an upgrade waits and defers it as an attempted call (ADR-0587)", async () => {
  vi.useFakeTimers();
  let runnerSignal: AbortSignal | null = null;
  const call = slowCall((signal) => (runnerSignal = signal));
  vi.mocked(createNoCapabilityProviderJsonRunner).mockResolvedValue({
    resolveObserved: (_request: unknown, signal: AbortSignal) => call(signal),
  } as unknown as Awaited<ReturnType<typeof createNoCapabilityProviderJsonRunner>>);
  let upgradeWaiting = false;
  const outcome = generateFreshnessProposal({
    context: freshnessContext(async () => upgradeWaiting),
    source: freshnessSource,
    generationId: "kfg_upgrade_preemption",
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(runnerSignal!.aborted).toBe(false);
  upgradeWaiting = true;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(runnerSignal!.aborted).toBe(true);
  expect(await outcome).toEqual({
    status: "deferred",
    reason: "knowledge_capacity_unavailable",
    attempted: true,
  });
  // The call may have spent tokens, so its usage is still recorded, as unavailable.
  expect(recordTurnMeasurement).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});

it("charges only a freshness call abandoned after it reached the provider (ADR-0587)", () => {
  expect(
    freshnessCallAbandoned({
      status: "deferred",
      reason: "knowledge_capacity_unavailable",
      attempted: true,
    }),
  ).toBe(true);
  // Never started: nothing was spent.
  expect(
    freshnessCallAbandoned({ status: "deferred", reason: "knowledge_capacity_unavailable" }),
  ).toBe(false);
  // A paused provider keeps its existing accounting.
  expect(
    freshnessCallAbandoned({
      status: "deferred",
      reason: "knowledge_provider_paused",
      attempted: true,
    }),
  ).toBe(false);
});

it("starts no freshness call while an upgrade already waits (ADR-0587)", async () => {
  vi.mocked(createNoCapabilityProviderJsonRunner).mockClear();
  const context = freshnessContext(async () => true);
  expect(
    await generateFreshnessProposal({
      context,
      source: freshnessSource,
      generationId: "kfg_upgrade_preemption",
    }),
  ).toEqual({ status: "deferred", reason: "knowledge_capacity_unavailable" });
  expect(acquireKnowledgeProviderAdmission).not.toHaveBeenCalled();
  expect(createNoCapabilityProviderJsonRunner).not.toHaveBeenCalled();
  expect(context.providerQuantum.remaining).toBe(1);
});

const job: RepositoryKnowledgeReviewJob = {
  changeEventId: "evt_upgrade_preemption",
  destinationId: "repository-knowledge",
  attemptCount: 1,
  subJobIndex: 0,
  subJobCount: 1,
  resolutionEventId: "evt_upgrade_preemption_resolution",
};

const reviewInput = (yieldToUpgrade: () => Promise<boolean>) => ({
  storage,
  provider: "claude" as const,
  signal: new AbortController().signal,
  liveWorkPending: async () => false,
  yieldToUpgrade,
});

it("abandons a change review call once an upgrade waits, so the job retries later (ADR-0587)", async () => {
  vi.useFakeTimers();
  let callSignal: AbortSignal | null = null;
  let upgradeWaiting = false;
  const governor = governChangeReviewCalls(reviewInput(async () => upgradeWaiting));
  const outcome = governor(
    job,
    slowCall((signal) => (callSignal = signal)),
  ).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(5_000);
  expect(callSignal!.aborted).toBe(false);
  upgradeWaiting = true;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(callSignal!.aborted).toBe(true);
  // A runtime error, not a review error: the job worker reschedules it instead of settling it.
  expect(await outcome).toMatchObject({ error: { code: "knowledge_capacity_unavailable" } });
  expect(recordChangeReviewUsage).toHaveBeenCalledOnce();
  expect(vi.mocked(recordChangeReviewUsage).mock.calls[0]![0]).toMatchObject({
    usage: null,
    reasonCode: "knowledge_provider_call_failed",
  });
  expect(release).toHaveBeenCalledOnce();
});

it("reserves no change review call while an upgrade already waits (ADR-0587)", async () => {
  const call = vi.fn();
  await expect(
    governChangeReviewCalls(reviewInput(async () => true))(job, call),
  ).rejects.toMatchObject({ code: "knowledge_capacity_unavailable" });
  expect(call).not.toHaveBeenCalled();
  expect(reserveConvergenceProviderCall).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
