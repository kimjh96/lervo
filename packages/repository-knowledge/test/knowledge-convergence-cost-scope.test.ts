import { expect, it } from "vitest";

import type {
  KnowledgeConvergenceHost,
  KnowledgeConvergenceInput,
  KnowledgeConvergenceStageResult,
} from "../src/knowledge-convergence-contract.js";
import { costScopedConvergenceHost } from "../src/knowledge-convergence-cost-scope.js";
import {
  observeProcessCost,
  recordSynchronousGitProcess,
} from "../src/process-cost-observation.js";

it("passes every host call through unchanged and attributes it to the claimed stage", async () => {
  const state = { obligationId: "kconv_test" } as unknown as KnowledgeConvergenceInput;
  const result = { state: "completed" } as unknown as KnowledgeConvergenceStageResult;
  const calls: unknown[][] = [];
  const work = (name: string, ...args: unknown[]) => {
    calls.push([name, ...args]);
    recordSynchronousGitProcess([name]);
  };
  const lease = () => undefined;
  const host: KnowledgeConvergenceHost = {
    evaluationContract: "contract",
    discover: async () => {
      work("discover");
      return { projectId: "p" } as unknown as Awaited<
        ReturnType<KnowledgeConvergenceHost["discover"]>
      >;
    },
    dependencyCurrent: async (hash) => {
      work("dependency", hash);
      return true;
    },
    assertCurrent: async (input) => work("current", input),
    assertSettlement: (input) => work("settle", input),
    prepareStage: async (stage, input) => {
      work("prepare", stage, input);
      return null;
    },
    runStage: async (stage, input, assertLease) => {
      work("run", stage, input, assertLease);
      return result;
    },
  };
  const observation = observeProcessCost();
  try {
    const scoped = costScopedConvergenceHost(host);
    expect(scoped.host.evaluationContract).toBe("contract");
    expect(await scoped.host.discover()).toEqual({ projectId: "p" });
    await scoped.host.assertCurrent(state);
    scoped.host.assertSettlement(state);
    scoped.enterStage("canonical_review");
    expect(await scoped.host.prepareStage!("canonical_review", state)).toBeNull();
    await scoped.host.assertCurrent(state);
    expect(await scoped.host.runStage("canonical_review", state, lease)).toBe(result);
    scoped.host.assertSettlement(state);
    expect(await scoped.host.dependencyCurrent("sha256:x")).toBe(true);
    expect(calls).toEqual([
      ["discover"],
      ["current", state],
      ["settle", state],
      ["prepare", "canonical_review", state],
      ["current", state],
      ["run", "canonical_review", state, lease],
      ["settle", state],
      ["dependency", "sha256:x"],
    ]);
    const scopes = Object.fromEntries(
      Object.entries(observation.snapshot().scopes).map(([name, scope]) => [
        name,
        scope.gitProcesses,
      ]),
    );
    expect(scopes).toEqual({
      discover: { discover: 1 },
      "discovery.assert_current": { current: 1 },
      "discovery.settle": { settle: 1 },
      "canonical_review.prepare": { prepare: 1 },
      "canonical_review.assert_current": { current: 1 },
      "canonical_review.run": { run: 1 },
      "canonical_review.settle": { settle: 1 },
      dependency: { dependency: 1 },
    });
  } finally {
    observation.close();
  }
});

it("keeps an absent optional stage preparation absent", () => {
  const host = { discover: async () => ({}) } as unknown as KnowledgeConvergenceHost;
  const scoped = costScopedConvergenceHost(host).host;
  expect(scoped.prepareStage).toBeUndefined();
  expect("evaluationContract" in scoped).toBe(false);
});
