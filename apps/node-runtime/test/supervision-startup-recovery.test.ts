import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { NodeSupervisionError } from "../src/supervision-authority.js";
import { openNodeSupervisionService } from "../src/supervision-startup.js";
import type { NodeRuntimeComponentHealth } from "../src/health-contract.js";

const fake = vi.hoisted(() => ({
  hooks: null as null | {
    onFailure(error: unknown): void;
    onCycle(cycle: { disposition: "idle" | "busy" | "changed"; report: unknown }): Promise<void>;
  },
}));
vi.mock("../src/outcome-supervision-runtime.js", () => ({
  openNodeOutcomeSupervisionRuntime: async () => ({
    start: (hooks: NonNullable<typeof fake.hooks>) => {
      fake.hooks = hooks;
    },
    close: async () => undefined,
  }),
}));

const roots: string[] = [];
afterEach(async () => {
  fake.hooks = null;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("restores evaluated health after an unchanged authority read, but not a busy cycle", async () => {
  const fixture = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const login = await createLoginFixture(roots);
  const observations: NodeRuntimeComponentHealth[] = [];
  const service = await openNodeSupervisionService({
    repositoryRoot: fixture.root,
    configuration: {
      binding: fixture.binding,
      runtimeReadiness: {
        providerExecutables: { codex: login.executable },
        providerLoginContexts: { codex: login.context },
        verificationTools: {},
        workerWorkspace: {
          parentDirectory: resolve(fixture.root, "workers"),
          baseCommit: "a".repeat(40),
          integrationTargetDigest: `sha256:${"b".repeat(64)}`,
        },
      },
      ownerReasoning: { provider: "codex", reservedTokens: 100 },
      managedExecution: {
        nodeExecutable: process.execPath,
        cliBundle: resolve("apps/cli/dist/bin.js"),
      },
    },
    observeHealth: async (health) => {
      observations.push(health);
    },
    log: () => undefined,
  });
  try {
    service.start();
    const hooks = fake.hooks;
    if (hooks === null) throw new Error("The supervision cycle did not start.");
    await hooks.onCycle({ disposition: "idle", report: null });
    expect(observations.at(-1)).toEqual({ status: "pending" });
    await hooks.onCycle({
      disposition: "changed",
      report: { status: "active", reasonCode: null, nextAction: null },
    });
    expect(observations.at(-1)).toEqual({ status: "ready" });
    hooks.onFailure(new NodeSupervisionError("supervision_authority_changed"));
    await vi.waitFor(() => expect(observations.at(-1)?.status).toBe("unavailable"));
    await hooks.onCycle({ disposition: "busy", report: null });
    expect(observations.at(-1)?.status).toBe("unavailable");
    await hooks.onCycle({ disposition: "idle", report: null });
    expect(observations.at(-1)).toEqual({ status: "ready" });
    const count = observations.length;
    await hooks.onCycle({ disposition: "idle", report: null });
    expect(observations).toHaveLength(count);
  } finally {
    await service.close();
  }
});
