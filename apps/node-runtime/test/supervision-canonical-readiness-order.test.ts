import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { projectOutcomeSupervision } from "@lervo/work-controller";
import { prepareCanonicalSupervisionReadiness } from "../src/supervision-canonical-readiness.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const clock = vi.hoisted(() => ({ nowMs: 0, workspaceReads: 0 }));
vi.mock("../src/supervision-workspace-source.js", async (importOriginal) => {
  const source = await importOriginal<typeof import("../src/supervision-workspace-source.js")>();
  return {
    ...source,
    readSupervisionWorkspaceSource: async (
      ...args: Parameters<typeof source.readSupervisionWorkspaceSource>
    ) => {
      const result = await source.readSupervisionWorkspaceSource(...args);
      if (clock.nowMs !== 0) {
        clock.workspaceReads++;
        clock.nowMs += 8000;
      }
      return result;
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  clock.nowMs = 0;
  clock.workspaceReads = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("starts the short task-context observation after slow workspace preparation", async () => {
  const f = await dispatchFixture(roots);
  const plan = {
    ...(await f.ports.propose(
      projectOutcomeSupervision({
        snapshot: f.observation,
        now: f.ports.now(),
        maximumRecoveryDecisions: 1,
      }),
    ))!,
    effectContract: "work.managed_execution.v1",
  };
  const admission = await f.ports.readAdmission(plan);
  clock.nowMs = Date.now();
  const now = () => new Date(clock.nowMs).toISOString();
  const readiness = await prepareCanonicalSupervisionReadiness({
    repositoryRoot: f.root,
    plan,
    responsibility: f.task,
    workstreamRevision: f.observation.workstreamRevision,
    admission,
    aggregateBudgetRequired: true,
    configuration: f.runtimeReadiness,
    now,
  });
  expect(clock.workspaceReads).toBe(1);
  expect(Date.parse(now()) - Date.parse(readiness.observation.observedAt)).toBeLessThanOrEqual(
    5000,
  );
});
