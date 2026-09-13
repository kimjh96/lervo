import { rm } from "node:fs/promises";
import { changeAgentStatus } from "@lervo/agent-workforce";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Node dispatch readiness integration", { timeout: 30_000 }, () => {
  it("accepts raw task-source readiness and reobserves it immediately before a fenced effect", async () => {
    const f = await dispatchFixture(roots);
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      expect(f.readinessReads()).toBe(2);
      expect(f.counts().effects).toBe(1);
    } finally {
      await runtime.close();
    }
  });
  it("blocks required write checks even when the adapter supplies no required-check list", async () => {
    const f = await dispatchFixture(roots);
    const read = f.ports.readWorkerReadiness;
    f.ports.readWorkerReadiness = async (plan) => {
      const result = await read(plan);
      result.observation.checks.find((check) => check.kind === "write_scope")!.status =
        "not_required";
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
      expect(f.attention.at(-1)).toContain("readiness_write_scope_not_required");
    } finally {
      await runtime.close();
    }
  });
  it.each(["readiness", "authority", "expiry"])(
    "does not invoke an effect after %s changes following the first preflight",
    async (change) => {
      const f = await dispatchFixture(roots);
      const read = f.ports.readWorkerReadiness;
      let calls = 0;
      f.ports.readWorkerReadiness = async (plan) => {
        const result = await read(plan);
        if (++calls === 2) {
          if (change === "readiness") result.observation.checks[0]!.status = "failed";
          if (change === "authority")
            await changeAgentStatus({
              repositoryRoot: f.root,
              agentId: f.owner.agentId,
              expectedRevision: 1,
              status: "suspended",
            });
          if (change === "expiry") result.observation.validUntil = f.ports.now();
        }
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
        expect(f.attention.at(-1)).toContain("supervision_preflight_failed");
      } finally {
        await runtime.close();
      }
    },
  );
});
