import { expect, it, vi } from "vitest";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { createConvergenceRuntimeHost } from "../src/host.js";
import { admittedBackgroundContext } from "../src/background-provider.js";
import { assessCanonicalBaseline } from "../src/canonical-assessment.js";

vi.mock("../src/background-provider.js", () => ({ admittedBackgroundContext: vi.fn() }));
vi.mock("../src/delegation.js", () => ({
  assertConvergenceDelegation: vi.fn(),
  loadConvergenceDelegation: vi.fn(),
}));
vi.mock("../src/source-capture.js", () => ({
  captureConvergenceSources: () => ({ snapshotHash: "snapshot" }),
}));
vi.mock("../src/materialization-transaction.js", () => ({
  materializationTransactionState: async () => "none",
}));
vi.mock("../src/settled-output-boundary.js", () => ({ settledOutputBoundary: () => false }));
vi.mock("../src/lifecycle-prefix.js", () => ({ prepareConvergenceLifecycle: async () => null }));
vi.mock("../src/canonical-assessment.js", () => ({ assessCanonicalBaseline: vi.fn() }));

it("runs and staffs the stage with the admitted fallback instead of the rejected preferred provider", async () => {
  const context = {
    provider: "codex",
    storage: { paths: { repositoryRoot: "/fixture" }, events: {}, artifacts: {} },
    signal: new AbortController().signal,
    assertSourceExact: () => {},
    assertSourceCurrent: () => {},
    liveWorkPending: async () => false,
  } as unknown as ConvergenceRuntimeContext;
  const selected = {
    ...context,
    provider: "claude" as const,
    executable: "/installed/claude",
    providerCliIdentityHash: "identity",
    providerCliIdentity: {
      provider: "claude" as const,
      executable: "/installed/claude",
      realPath: "/installed/claude",
      fingerprint: "1:2:3:4",
      versionOutputHash: null,
      environment: { HOME: "/fixture", SHELL: "/bin/sh", PATH: "/usr/bin:/bin" },
      version: "1.2.3",
      executableHash: "hash",
      identityHash: "identity",
    },
  };
  vi.mocked(admittedBackgroundContext).mockResolvedValue(selected);
  const state = {
    snapshotHash: "snapshot",
    baseline: {
      projectId: "prj_provider_cli_test",
      policyHash: "policy",
      delegationHash: "delegation",
    },
    stageData: {},
    receipts: [],
  } as unknown as KnowledgeConvergenceInput;
  const result = {
    state: "current" as const,
    input: state,
    assignmentId: null,
    leaseGeneration: null,
    failureCode: null,
    dependencyHash: null,
    nextStage: "canonical_review" as const,
  };
  vi.mocked(assessCanonicalBaseline).mockResolvedValue(result);
  expect(await createConvergenceRuntimeHost(context).runStage("assessment", state, () => {})).toBe(
    result,
  );
  expect(assessCanonicalBaseline).toHaveBeenCalledWith(selected, state, expect.any(Function));
  expect(context.provider).toBe("codex");
});
