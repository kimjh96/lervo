import { afterEach, expect, it, vi } from "vitest";
import type { ProjectStorage } from "@lervo/project-storage";
import type { ModelSelection } from "@lervo/execution-contract";

import {
  admittedBackgroundContext,
  backgroundProviderOptions,
} from "../src/background-provider.js";
import { resolveAdmittedProviderCli } from "../src/provider-cli-admission.js";
import type { ProviderCliIdentity } from "../src/provider-cli-identity.js";

const delegated = vi.hoisted(() => ({ providers: ["claude", "codex"] as string[] }));
vi.mock("../src/provider-cli-admission.js", () => ({ resolveAdmittedProviderCli: vi.fn() }));
vi.mock("../src/delegation.js", () => ({
  assertConvergenceDelegation: vi.fn(),
  loadConvergenceDelegation: async () => ({
    contentHash: `sha256:${"a".repeat(64)}`,
    delegation: {
      state: "active",
      projectId: "prj_selection",
      expiresAt: "2099-01-01T00:00:00Z",
      providers: delegated.providers,
      resourceCeilings: { maximumProviderCalls: 8 },
    },
  }),
}));
vi.mock("../src/convergence-owner-host.js", () => ({ readConvergenceOwnerHost: async () => null }));
afterEach(() => {
  vi.clearAllMocks();
  delegated.providers = ["claude", "codex"];
});

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

it("orders admission by the background routes and falls through only to listed ones (ADR-0612)", async () => {
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

it("never tries a provider the role leaves out, even when the delegation allows it", async () => {
  admit(identity("claude"));
  await admittedBackgroundContext(
    context({
      ...selection,
      roles: { background: [{ provider: "claude", model: null, reasoningEffort: null }] },
    }),
  );
  expect(vi.mocked(resolveAdmittedProviderCli).mock.calls[0]![0]).toMatchObject({
    preferred: "claude",
    allowed: ["claude"],
  });
});

it("waits when the role lists only providers the delegation does not allow", async () => {
  delegated.providers = ["claude"];
  admit(identity("claude"));
  await expect(
    admittedBackgroundContext(
      context({
        ...selection,
        roles: { background: [{ provider: "codex", model: null, reasoningEffort: null }] },
      }),
    ),
  ).rejects.toMatchObject({ code: "provider_not_admitted" });
  expect(resolveAdmittedProviderCli).not.toHaveBeenCalled();
});

it("reads a change of the host selection at the next admission, without a restart", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const { writeModelSelectionRole } = await import("@lervo/execution-contract");
  const root = await mkdtemp(resolve(tmpdir(), "lervo-model-selection-live-"));
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", resolve(root, "state"));
  try {
    const { modelSelection: _unused, ...live } = context(selection);
    admit(identity("claude"));
    await writeModelSelectionRole({
      stateDirectory: resolve(root, "state"),
      role: "background",
      routes: [{ provider: "claude", model: "first-model", reasoningEffort: "medium" }],
    });
    const first = await admittedBackgroundContext(live);
    expect(first.modelRoute).toEqual({ model: "first-model", reasoningEffort: "medium" });
    await writeModelSelectionRole({
      stateDirectory: resolve(root, "state"),
      role: "background",
      routes: [{ provider: "claude", model: "second-model", reasoningEffort: "high" }],
    });
    const second = await admittedBackgroundContext(live);
    expect(second.modelRoute).toEqual({ model: "second-model", reasoningEffort: "high" });
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
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
