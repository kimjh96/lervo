import { afterEach, expect, it, vi } from "vitest";
import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { acquireKnowledgeProviderAdmission } from "../src/provider-admission.js";
import { KnowledgeConvergenceRuntimeError } from "../src/failure.js";
import { withKnowledgeProviderAdmission } from "../src/provider-call.js";
import type { ConvergenceAssignmentAuthority } from "../src/workforce.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";

vi.mock("../src/provider-admission.js", () => ({ acquireKnowledgeProviderAdmission: vi.fn() }));
vi.mock("../src/provider-budget.js", () => ({ reserveConvergenceProviderCall: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
});

const state = {
  obligationId: "kconv_provider_abort",
  snapshotHash: sha256("source"),
  baseline: { policyHash: sha256("policy") },
  stageData: {},
  receipts: [],
} as unknown as KnowledgeConvergenceInput;

it.each([
  ["source", "source_bytes_changed"],
  ["delegation", "knowledge_authority_unavailable"],
] as const)(
  "cancels an in-flight provider when its %s changes and never returns the answer",
  async (kind, code) => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    vi.mocked(acquireKnowledgeProviderAdmission).mockResolvedValue({
      observationHash: sha256("admission"),
      release,
    });
    const drift = new KnowledgeConvergenceRuntimeError(code);
    let drifted = false;
    const context = {
      storage: { paths: { repositoryRoot: "/repository" }, events: {} },
      provider: "claude",
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      assertSourceExact: () => {},
      assertSourceCurrent: () => {
        if (kind === "source" && drifted) throw drift;
      },
    } as unknown as ConvergenceRuntimeContext;
    const authority = {
      assertCurrent: async () => {
        if (kind === "delegation" && drifted) throw drift;
      },
    } as unknown as ConvergenceAssignmentAuthority;
    let providerSignal: AbortSignal | null = null;
    // The provider answers after five seconds unless its process is cancelled first.
    const call = withKnowledgeProviderAdmission({
      context,
      state,
      authority,
      budget: { batchId: "batch", maximumCalls: 3 },
      run: (_observationHash, signal) => {
        providerSignal = signal;
        return new Promise<string>((resolveAnswer, rejectAnswer) => {
          const answer = setTimeout(() => resolveAnswer("an answer about stale bytes"), 5_000);
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
    });
    const outcome = call.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(providerSignal).not.toBeNull();
    expect(providerSignal!.aborted).toBe(false);
    drifted = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(providerSignal!.aborted).toBe(true);
    expect(await outcome).toEqual({ error: drift });
    expect(release).toHaveBeenCalledOnce();
  },
);
