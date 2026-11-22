import { afterEach, expect, it, vi } from "vitest";
import type { ProjectStorage } from "@lervo/project-storage";
import type { ModelSelection } from "@lervo/execution-contract";

import {
  admittedBackgroundContext,
  backgroundProviderOptions,
} from "../src/background-provider.js";
import { resolveAdmittedProviderCli } from "../src/provider-cli-admission.js";
import type { ProviderCliIdentity } from "../src/provider-cli-identity.js";

vi.mock("../src/provider-cli-admission.js", () => ({ resolveAdmittedProviderCli: vi.fn() }));
vi.mock("../src/delegation.js", () => ({
  assertConvergenceDelegation: vi.fn(),
  loadConvergenceDelegation: async () => ({
    contentHash: `sha256:${"a".repeat(64)}`,
    delegation: {
      state: "active",
      projectId: "prj_selection",
      expiresAt: "2099-01-01T00:00:00Z",
      providers: ["claude", "codex"],
      resourceCeilings: { maximumProviderCalls: 8 },
    },
  }),
}));
vi.mock("../src/convergence-owner-host.js", () => ({ readConvergenceOwnerHost: async () => null }));
afterEach(() => vi.clearAllMocks());

const identity = (provider: "codex" | "claude"): ProviderCliIdentity =>
  ({
    provider,
    executable: `/bin/${provider}`,
    environment: {},
    identityHash: `sha256:${"b".repeat(64)}`,
  }) as unknown as ProviderCliIdentity;

function admit(selected: ProviderCliIdentity) {
  vi.mocked(resolveAdmittedProviderCli).mockResolvedValue({
    selected,
    projection: {
      observedAt: new Date().toISOString(),
      detectionFailure: null,
      providers: [],
      selected: null,
      waiting: false,
    },
  });
}

const context = (modelSelection: ModelSelection, executable?: string) => ({
  storage: {
    paths: { repositoryRoot: "/repository" },
    manifest: { projectId: "prj_selection" },
  } as ProjectStorage,
  provider: "claude" as const,
  liveWorkPending: async () => false,
  modelSelection,
  ...(executable === undefined ? {} : { executable }),
});

const selection: ModelSelection = {
  schemaVersion: 1,
  revision: 3,
  changedAt: "2026-11-22T13:00:00.000Z",
  roles: {
    background: [
      { provider: "codex", model: "gpt-test", reasoningEffort: "medium" },
      { provider: "claude", model: "claude-test", reasoningEffort: "high" },
    ],
  },
};

it("orders admission by the background routes and falls through to the next one (ADR-0612)", async () => {
  // Codex is first in the role but cannot run here, so admission selects Claude.
  admit(identity("claude"));
  const admitted = await admittedBackgroundContext(context(selection));
  expect(vi.mocked(resolveAdmittedProviderCli).mock.calls[0]![0]).toMatchObject({
    preferred: "codex",
    allowed: ["codex", "claude"],
  });
  expect(admitted.modelRoute).toEqual({ model: "claude-test", reasoningEffort: "high" });
  expect(backgroundProviderOptions(admitted)).toMatchObject({
    provider: "claude",
    model: "claude-test",
    reasoningEffort: "high",
  });
});

it("keeps today's behavior when the role is unset, and a pinned executable keeps its provider", async () => {
  admit(identity("claude"));
  const unset = await admittedBackgroundContext(
    context({ schemaVersion: 1, revision: 0, changedAt: null, roles: {} }),
  );
  expect(vi.mocked(resolveAdmittedProviderCli).mock.calls[0]![0]).toMatchObject({
    preferred: "claude",
    allowed: ["claude", "codex"],
  });
  const options = backgroundProviderOptions(unset);
  expect(options).not.toHaveProperty("model");
  expect(options).toMatchObject({ reasoningEffort: "low" });
  await admittedBackgroundContext(context(selection, "/opt/claude"));
  expect(vi.mocked(resolveAdmittedProviderCli).mock.calls[1]![0]).toMatchObject({
    preferred: "claude",
    executable: "/opt/claude",
  });
});
