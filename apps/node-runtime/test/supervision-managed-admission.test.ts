import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { supervisedManagedExecutionFields } from "@lervo/work-controller";
import type { SupervisedManagedExecutionV1 } from "@lervo/application-contract";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { admitSupervisedManagedInvocation } from "../src/supervision-managed-admission.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("supervised managed worker admission", { timeout: 30_000 }, () => {
  it.each(["exact", "instructions", "owner token", "workspace"])(
    "reobserves the durable decision, authority and workspace before %s invocation",
    async (change) => {
      const f = await dispatchFixture(roots);
      const effect: SupervisedManagedExecutionV1 = {
        schemaVersion: 1,
        kind: "work.managed_execution",
        responsibility: f.task,
        leaseId: f.assignment.lease!.leaseId,
        provider: "codex",
        instructions: "Verify the saved value in src/save.ts.",
        risk: "low",
        reservedTokens: 100,
      };
      const propose = f.ports.propose;
      f.ports.propose = async (report) => ({
        ...(await propose(report))!,
        ...supervisedManagedExecutionFields(effect),
      });
      const readAdmission = f.ports.readAdmission;
      f.ports.readAdmission = async (plan) => ({
        ...(await readAdmission(plan)),
        effectMappings: [{ actionKind: "dispatch", contract: "work.managed_execution.v1" }],
      });
      let commits = 0;
      const execute = f.ports.execute;
      f.ports.execute = async (plan, review, fence) => {
        const invocation = fence.managedInvocation(plan, effect);
        if (change === "instructions") invocation.effect.instructions = "Different task";
        if (change === "owner token") invocation.ownerLease.token = "invalid";
        const storage = await openProjectStorage(f.root);
        try {
          await admitSupervisedManagedInvocation({
            storage,
            invocation,
            executionRepositoryRoot: change === "workspace" ? f.root : f.workspacePath,
            now: f.ports.now,
            commit: () => {
              commits++;
            },
          });
        } finally {
          await storage.close();
        }
        return execute(plan, review, fence);
      };
      const runtime = await openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: f.ports,
        runtimeReadiness: f.runtimeReadiness,
      });
      try {
        const result = await runtime.runCycle();
        expect(result.disposition).toBe(change === "exact" ? "effect_confirmed" : "uncertain");
        expect(commits).toBe(change === "exact" ? 1 : 0);
      } finally {
        await runtime.close();
      }
    },
  );
});
