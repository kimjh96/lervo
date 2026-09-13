import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { snapshotRuntimeReadinessConfiguration } from "../src/supervision-runtime-configuration.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

import { tmpdir } from "node:os";
import { resolve } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("supervision executable observations", { timeout: 30_000 }, () => {
  it.each(["configuration", "provider", "tool", "suite"])(
    "blocks dispatch without observed %s",
    async (missing) => {
      const f = await dispatchFixture(roots);
      if (missing === "provider")
        f.runtimeReadiness.providerExecutables.codex = "/missing/lervo-provider";
      if (missing === "tool")
        Object.values(f.runtimeReadiness.verificationTools)[0]![0]!.executable =
          "/missing/lervo-tool";
      if (missing === "suite") f.runtimeReadiness.verificationTools = {};
      const runtime = await openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: f.ports,
        ...(missing === "configuration" ? {} : { runtimeReadiness: f.runtimeReadiness }),
      });
      try {
        expect((await runtime.runCycle()).disposition).toBe("blocked");
        expect(f.counts().effects).toBe(0);
        expect(f.attention.at(-1)).toContain(
          missing === "configuration" || missing === "provider"
            ? "readiness_provider_unobserved"
            : "readiness_tools_unobserved",
        );
      } finally {
        await runtime.close();
      }
    },
  );

  it.each(["failed", "unobserved"] as const)(
    "never promotes %s auth evidence after a successful version probe",
    async (status) => {
      const f = await dispatchFixture(roots);
      const read = f.ports.readWorkerReadiness;
      f.ports.readWorkerReadiness = async (plan) => {
        const result = await read(plan);
        result.observation.checks.find((check) => check.kind === "provider")!.status = status;
        return result;
      };
      const runtime = await openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: f.ports,
        runtimeReadiness: f.runtimeReadiness,
      });
      try {
        expect((await runtime.runCycle()).disposition).toBe("blocked");
        expect(f.counts().effects).toBe(0);
        expect(f.attention.at(-1)).toContain(`readiness_provider_${status}`);
      } finally {
        await runtime.close();
      }
    },
  );

  it("captures trusted configuration before opening the runtime", async () => {
    const f = await dispatchFixture(roots);
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    f.runtimeReadiness.providerExecutables.codex = "/missing/changed-after-open";
    try {
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      expect(f.readinessReads()).toBe(2);
    } finally {
      await runtime.close();
    }
  });

  it("reobserves an executable removed after the first preflight", async () => {
    const f = await dispatchFixture(roots);
    const directory = await mkdtemp(resolve(tmpdir(), "lervo-runtime-probe-"));
    roots.push(directory);
    const executable = resolve(directory, "provider");
    await symlink(f.runtimeReadiness.providerExecutables.codex, executable);
    f.runtimeReadiness.providerExecutables.codex = executable;
    const read = f.ports.readWorkerReadiness;
    let reads = 0;
    f.ports.readWorkerReadiness = async (plan) => {
      if (++reads === 2) await rm(executable);
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
      expect(reads).toBe(2);
    } finally {
      await runtime.close();
    }
  });

  it("rejects relative executables and conflicting tool identities", () => {
    expect(() =>
      snapshotRuntimeReadinessConfiguration({
        providerExecutables: { codex: "codex" },
        verificationTools: {},
      }),
    ).toThrow(TypeError);
    expect(() =>
      snapshotRuntimeReadinessConfiguration({
        providerExecutables: {},
        verificationTools: {
          first: [{ toolId: "node", executable: process.execPath }],
          second: [{ toolId: "node", executable: "/different/node" }],
        },
      }),
    ).toThrow(TypeError);
  });
});
