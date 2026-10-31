import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectStorage } from "@lervo/project-storage";
import { recordTurnMeasurement } from "@lervo/execution-contract";
import {
  createNoCapabilityProviderJsonRunner,
  probeProviderCli,
} from "@lervo/repository-knowledge-compiler";
import { sha256 } from "@lervo/repository-knowledge";
import {
  knowledgeProviderAdmissionState,
  pauseKnowledgeProvider,
  settleKnowledgeProviderProbe,
} from "../src/provider-admission.js";
import { resolveAdmittedProviderCli } from "../src/provider-cli-admission.js";
import { probeBackgroundProviderCli } from "../src/provider-cli-probe-budget.js";
import { providerCliFindings } from "../src/provider-cli-findings.js";
import { readKnowledgeProviderPauseStates } from "../src/provider-admission-inspection.js";
import { reserveConvergenceProviderCall } from "../src/provider-budget.js";

vi.mock("@lervo/repository-knowledge-compiler", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge-compiler")>()),
  probeProviderCli: vi.fn(),
  createNoCapabilityProviderJsonRunner: vi.fn(),
}));
vi.mock("@lervo/execution-contract", async (original) => ({
  ...(await original<typeof import("@lervo/execution-contract")>()),
  recordTurnMeasurement: vi.fn(),
}));
vi.mock("../src/provider-budget.js", () => ({ reserveConvergenceProviderCall: vi.fn() }));

const roots: string[] = [];
const origin = new Date("2026-09-28T00:00:00.000Z");
const hour = 60 * 60_000;
const usage = {
  inputTokens: 10,
  cachedInputTokens: 0,
  outputTokens: 5,
  reasoningOutputTokens: 0,
  totalTokens: 15,
  contextWindow: 200000,
};
afterEach(async () => {
  vi.useRealTimers();
  vi.resetAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(provider: "claude" | "codex" = "claude") {
  vi.useFakeTimers();
  vi.setSystemTime(origin);
  const home = await mkdtemp(resolve(tmpdir(), "lervo-pause-reprobe-"));
  roots.push(home);
  await mkdir(resolve(home, ".local/bin"), { recursive: true });
  await writeFile(resolve(home, ".local/bin", provider), "installed native fixture", {
    mode: 0o700,
  });
  const directory = resolve(home, "admission");
  const storage = {
    paths: { repositoryRoot: home },
    manifest: { projectId: "prj_pause" },
    writableEventSchemaVersion: 4,
    events: { get: () => null, append: vi.fn() },
  } as unknown as ProjectStorage;
  const pause = (observation: string, resetAt: string | null = null) =>
    pauseKnowledgeProvider({
      provider,
      directory,
      reason: "quota",
      resetAt,
      observationHash: sha256(observation),
    });
  await pause("original");
  vi.mocked(probeProviderCli).mockImplementation(async (request) => {
    await request.observeUsage?.(usage);
    return { admitted: true, probeResultHash: sha256("passed") };
  });
  const run = (
    allowed: readonly ("claude" | "codex")[] = [provider],
    admissionMode: "probe" | "cached" = "probe",
  ) =>
    resolveAdmittedProviderCli({
      storage,
      preferred: provider,
      allowed,
      admissionMode,
      directory: resolve(home, "cache"),
      ports: {
        home,
        shell: "/absent-shell",
        prefixes: [],
        command: async () => ({ status: "completed", stdout: "2.1.308" }),
      },
      providerPaused: (candidate) =>
        knowledgeProviderAdmissionState({ provider: candidate, directory }),
      probe: (identity) =>
        probeBackgroundProviderCli({
          storage,
          identity,
          delegationHash: sha256("delegation"),
          maximumCalls: 8,
          liveWorkPending: async () => false,
          admissionDirectory: directory,
        }),
    });
  return {
    provider,
    directory,
    installFallback: () =>
      writeFile(
        resolve(home, ".local/bin", provider === "codex" ? "claude" : "codex"),
        "installed fallback fixture",
        { mode: 0o700 },
      ),
    pause,
    run,
    state: () => knowledgeProviderAdmissionState({ provider, directory }),
  };
}

it("re-probes a NULL reset at one hour and clears it only after native success and paid usage", async () => {
  const f = await fixture();
  vi.setSystemTime(new Date(origin.getTime() + hour - 1));
  expect((await f.run()).selected).toBeNull();
  expect(probeProviderCli).not.toHaveBeenCalled();
  vi.setSystemTime(new Date(origin.getTime() + hour));
  expect((await f.run()).selected?.provider).toBe("claude");
  expect(await f.state()).toMatchObject({ paused: false, nextReprobeAt: null });
  expect(reserveConvergenceProviderCall).toHaveBeenCalledTimes(1);
  expect(recordTurnMeasurement).toHaveBeenCalledTimes(1);
});

it("doubles NULL-reset re-probe delays up to 24 hours without silently resuming", async () => {
  const f = await fixture();
  vi.mocked(probeProviderCli).mockResolvedValue({
    admitted: false,
    reason: "probe_timed_out",
    exposedTools: [],
  });
  let elapsed = 0;
  for (const delay of [1, 2, 4, 8, 16, 24, 24]) {
    const count = vi.mocked(probeProviderCli).mock.calls.length;
    vi.setSystemTime(new Date(origin.getTime() + elapsed + delay * hour - 1));
    expect((await f.run()).selected).toBeNull();
    expect(probeProviderCli).toHaveBeenCalledTimes(count);
    elapsed += delay * hour;
    vi.setSystemTime(new Date(origin.getTime() + elapsed));
    expect((await f.run()).selected).toBeNull();
    expect(probeProviderCli).toHaveBeenCalledTimes(count + 1);
    expect((await f.state()).paused).toBe(true);
  }
});

it("keeps a newer native failure recorded during a successful re-probe", async () => {
  const f = await fixture();
  vi.setSystemTime(new Date(origin.getTime() + hour));
  vi.mocked(probeProviderCli).mockImplementation(async (request) => {
    await f.pause("newer failure");
    await request.observeUsage?.(usage);
    return { admitted: true, probeResultHash: sha256("passed") };
  });
  expect((await f.run()).selected).toBeNull();
  expect(await f.state()).toMatchObject({
    paused: true,
    observationHash: sha256("newer failure"),
    nextReprobeAt: new Date(origin.getTime() + 3 * hour).toISOString(),
  });
});

it("reports a 33-day pause and its due time while delegation excludes the provider", async () => {
  const f = await fixture();
  const now = new Date(origin.getTime() + 33 * 24 * hour);
  vi.setSystemTime(now);
  const result = await f.run(["codex"]);
  expect(probeProviderCli).not.toHaveBeenCalled();
  expect(reserveConvergenceProviderCall).not.toHaveBeenCalled();
  expect((await f.state()).paused).toBe(true);
  expect(
    providerCliFindings(
      result.projection,
      await readKnowledgeProviderPauseStates({ directory: f.directory }),
      now,
    ),
  ).toContainEqual(
    expect.objectContaining({
      code: "provider_not_admitted",
      severity: "attention",
      actor: "provider admission",
      detail: expect.stringContaining(
        `age_ms=${33 * 24 * hour}:next_reprobe_at=${new Date(origin.getTime() + hour).toISOString()}`,
      ),
    }),
  );
});

it("does not probe during cached-only observation or before a known reset", async () => {
  const f = await fixture();
  vi.setSystemTime(new Date(origin.getTime() + hour));
  await f.run(["claude"], "cached");
  expect(probeProviderCli).not.toHaveBeenCalled();
  await f.pause("known reset", new Date(origin.getTime() + 5 * hour).toISOString());
  await f.run();
  expect(probeProviderCli).not.toHaveBeenCalled();
});

it("requires a paid native Codex availability result after its model-input contract passes", async () => {
  const f = await fixture("codex");
  vi.setSystemTime(new Date(origin.getTime() + hour));
  vi.mocked(createNoCapabilityProviderJsonRunner).mockResolvedValue({
    provider: "codex",
    resolve: vi.fn(),
    resolveObserved: vi.fn(async (request: unknown) => ({
      value: {
        nonce: (request as { untrustedSourceData: { nonce: string } }).untrustedSourceData.nonce,
      },
      usage,
    })),
  });
  expect((await f.run()).selected?.provider).toBe("codex");
  expect(createNoCapabilityProviderJsonRunner).toHaveBeenCalledTimes(1);
  expect(reserveConvergenceProviderCall).toHaveBeenCalledTimes(1);
  expect(recordTurnMeasurement).toHaveBeenCalledTimes(1);
  expect((await f.state()).paused).toBe(false);
});

it("requires fresh recovery even for an already admitted cached executable", async () => {
  const f = await fixture();
  const prior = await f.state();
  await settleKnowledgeProviderProbe({
    provider: f.provider,
    directory: f.directory,
    priorObservationHash: prior.observationHash,
    priorObservedAt: prior.observedAt,
    observationHash: sha256("manual recovery"),
  });
  expect((await f.run()).selected?.provider).toBe("claude");
  await f.pause("quota after cached admission");
  vi.mocked(probeProviderCli).mockClear();
  vi.setSystemTime(new Date(origin.getTime() + hour));
  expect((await f.run()).selected?.provider).toBe("claude");
  expect(probeProviderCli).toHaveBeenCalledTimes(1);
  expect((await f.state()).paused).toBe(false);
});

it.each([
  {
    stage: "preflight",
    failure: { code: "knowledge_compile_failed", processStatus: "timed_out" },
    reason: "probe_timed_out",
  },
  {
    stage: "preflight",
    failure: { code: "knowledge_compile_policy_violation", probeFailureReason: "probe_timed_out" },
    reason: "probe_timed_out",
  },
  {
    stage: "call",
    failure: { code: "knowledge_compile_failed", processStatus: "timed_out" },
    reason: "probe_timed_out",
  },
  { stage: "call", failure: { code: "knowledge_compile_failed" }, reason: "probe_failed" },
  {
    stage: "call",
    failure: { code: "knowledge_compile_policy_violation" },
    reason: "probe_failed",
  },
  { stage: "invalid_nonce", failure: {}, reason: "probe_failed" },
])(
  "continues to an allowed fallback after $stage returns $reason",
  async ({ stage, failure, reason }) => {
    const f = await fixture("codex");
    await f.installFallback();
    vi.setSystemTime(new Date(origin.getTime() + hour));
    const error = Object.assign(new Error("native re-probe failed"), failure);
    if (stage === "preflight")
      vi.mocked(createNoCapabilityProviderJsonRunner).mockRejectedValue(error);
    else
      vi.mocked(createNoCapabilityProviderJsonRunner).mockResolvedValue({
        provider: "codex",
        resolve: vi.fn(),
        resolveObserved:
          stage === "invalid_nonce"
            ? vi.fn(async () => ({ value: { nonce: "wrong" }, usage }))
            : vi.fn().mockRejectedValue(error),
      });
    const result = await f.run(["codex", "claude"]);
    expect(result.selected?.provider).toBe("claude");
    expect(result.projection.providers).toContainEqual(
      expect.objectContaining({ provider: "codex", admitted: false, reason }),
    );
    expect(await f.state()).toMatchObject({
      paused: true,
      nextReprobeAt: new Date(origin.getTime() + 3 * hour).toISOString(),
    });
    expect(reserveConvergenceProviderCall).toHaveBeenCalledTimes(2);
    expect(recordTurnMeasurement).toHaveBeenCalledTimes(2);
  },
);

it.each(["knowledge_authority_unavailable", "normalization_budget_exceeded"])(
  "propagates %s from a re-probe instead of selecting a fallback",
  async (code) => {
    const f = await fixture("codex");
    await f.installFallback();
    vi.setSystemTime(new Date(origin.getTime() + hour));
    const failure = Object.assign(new Error("re-probe authority denied"), { code });
    vi.mocked(createNoCapabilityProviderJsonRunner).mockRejectedValue(failure);
    await expect(f.run(["codex", "claude"])).rejects.toBe(failure);
    expect(probeProviderCli).toHaveBeenCalledTimes(1);
    expect((await f.state()).paused).toBe(true);
  },
);

it("propagates a denied spend reservation without a native re-probe or fallback", async () => {
  const f = await fixture("codex");
  await f.installFallback();
  vi.setSystemTime(new Date(origin.getTime() + hour));
  const failure = Object.assign(new Error("budget denied"), {
    code: "normalization_budget_exceeded",
  });
  vi.mocked(reserveConvergenceProviderCall).mockRejectedValue(failure);
  await expect(f.run(["codex", "claude"])).rejects.toBe(failure);
  expect(createNoCapabilityProviderJsonRunner).not.toHaveBeenCalled();
  expect(probeProviderCli).toHaveBeenCalledTimes(1);
  expect((await f.state()).paused).toBe(true);
});
