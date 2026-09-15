import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { claimAssignment } from "@lervo/agent-workforce";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
const execute = promisify(execFile);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonical repository readiness probes", () => {
  it.each(["lease_generation", "workspace_absent", "marker_drift", "foreign_path"])(
    "rejects positive adapter claims after %s changes",
    async (change) => {
      const f = await dispatchFixture(roots);
      // A renewal keeps the same lease; only a claim past its expiry changes the authority.
      if (change === "lease_generation")
        await claimAssignment({
          repositoryRoot: f.root,
          assignmentId: f.assignment.assignmentId,
          agentId: f.assignment.assigneeAgentId!,
          sessionId: "ses_readiness_reclaim",
          now: new Date(Date.parse(f.assignment.lease!.expiresAt) + 1000),
        });
      if (change === "workspace_absent") await rm(f.workspacePath, { recursive: true });
      if (change === "marker_drift") {
        const gitDirectory = (
          await execute("git", ["-C", f.workspacePath, "rev-parse", "--absolute-git-dir"])
        ).stdout.trim();
        await writeFile(resolve(gitDirectory, "lervo-workspace-owner.json"), "{}\n");
      }
      if (change === "foreign_path")
        await writeFile(resolve(f.workspacePath, "outside.txt"), "out of scope\n");
      const runtime = await openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: f.ports,
        runtimeReadiness: f.runtimeReadiness,
      });
      try {
        expect((await runtime.runCycle()).disposition).toBe("blocked");
        expect(f.counts().effects).toBe(0);
        expect(f.attention.at(-1)).toContain("readiness_workspace_unobserved");
      } finally {
        await runtime.close();
      }
    },
  );
  it("reobserves the actual workspace after the first successful preflight", async () => {
    const f = await dispatchFixture(roots);
    const read = f.ports.readWorkerReadiness;
    let reads = 0;
    f.ports.readWorkerReadiness = async (plan) => {
      const observation = await read(plan);
      if (++reads === 2) await writeFile(resolve(f.workspacePath, "foreign.txt"), "changed\n");
      return observation;
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
    } finally {
      await runtime.close();
    }
  });
  it("preserves unobserved provider evidence despite valid repository and Git observations", async () => {
    const f = await dispatchFixture(roots);
    const read = f.ports.readWorkerReadiness;
    f.ports.readWorkerReadiness = async (plan) => {
      const observed = await read(plan);
      observed.observation.checks.find((check) => check.kind === "provider")!.status = "unobserved";
      return observed;
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(f.attention.at(-1)).toContain("readiness_provider_unobserved");
      expect(f.counts().effects).toBe(0);
    } finally {
      await runtime.close();
    }
  });
});
