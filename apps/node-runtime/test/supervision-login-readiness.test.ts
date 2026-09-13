import {
  snapshotRuntimeReadinessConfiguration,
  type NodeRuntimeReadinessConfiguration,
} from "../src/supervision-runtime-configuration.js";
import { afterEach, describe, expect, it } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Node native login readiness", () => {
  it.each(["absent", "malformed", "context"])(
    "blocks execution when login observation is %s",
    async (state) => {
      const f = await dispatchFixture(roots);
      const configuration: NodeRuntimeReadinessConfiguration = f.runtimeReadiness;
      if (state === "context") configuration.providerLoginContexts = {};
      else await writeFile(f.login.statePath, state);
      const runtime = await openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: f.ports,
        runtimeReadiness: configuration,
      });
      try {
        expect((await runtime.runCycle()).disposition).toBe("blocked");
        expect(f.counts().effects).toBe(0);
        expect(f.attention.at(-1)).toContain("readiness_provider_unobserved");
      } finally {
        await runtime.close();
      }
    },
  );
  it("reobserves stored login status immediately before effect invocation", async () => {
    const f = await dispatchFixture(roots);
    const read = f.ports.readWorkerReadiness;
    let count = 0;
    f.ports.readWorkerReadiness = async (plan) => {
      if (++count === 2) await writeFile(f.login.statePath, "absent");
      return read(plan);
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("uncertain");
      expect(f.counts().effects).toBe(0);
      expect(count).toBe(2);
    } finally {
      await runtime.close();
    }
  }, 30_000);
  it("keeps the originally configured profile after caller mutation", async () => {
    const f = await dispatchFixture(roots);
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    f.runtimeReadiness.providerLoginContexts.codex.configurationDirectory = "/missing/profile";
    try {
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
    } finally {
      await runtime.close();
    }
  });
});

it("rejects credential-shaped extras in login context", () => {
  const configuration = {
    providerExecutables: {},
    verificationTools: {},
    providerLoginContexts: {
      codex: {
        homeDirectory: process.cwd(),
        configurationDirectory: process.cwd(),
        apiKey: "unsupported-fixture",
      },
    },
  };
  expect(() => snapshotRuntimeReadinessConfiguration(configuration)).toThrow(TypeError);
});
