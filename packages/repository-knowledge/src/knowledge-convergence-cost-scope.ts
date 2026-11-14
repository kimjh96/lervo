import type { KnowledgeConvergenceStage } from "@lervo/schemas";

import type { KnowledgeConvergenceHost } from "./knowledge-convergence-contract.js";
import { withProcessCostScope } from "./process-cost-observation.js";

/**
 * Attributes each host call's process cost to `<stage>.<phase>`, or `discovery.<phase>` before the
 * owner claims a stage. Calls, arguments, and results pass through unchanged.
 */
export function costScopedConvergenceHost(host: KnowledgeConvergenceHost): {
  host: KnowledgeConvergenceHost;
  enterStage(stage: KnowledgeConvergenceStage): void;
} {
  let current: KnowledgeConvergenceStage | "discovery" = "discovery";
  const scoped = <T>(phase: string, run: () => T) =>
    withProcessCostScope(`${current}.${phase}`, run);
  const prepareStage = host.prepareStage?.bind(host);
  const evaluationContract = host.evaluationContract;
  return {
    enterStage(stage) {
      current = stage;
    },
    host: {
      ...(evaluationContract === undefined ? {} : { evaluationContract }),
      discover: () => withProcessCostScope("discover", () => host.discover()),
      dependencyCurrent: (hash) =>
        withProcessCostScope("dependency", () => host.dependencyCurrent(hash)),
      assertCurrent: (state) => scoped("assert_current", () => host.assertCurrent(state)),
      assertSettlement: (state) => scoped("settle", () => host.assertSettlement(state)),
      runStage: (stage, state, assertLease) =>
        scoped("run", () => host.runStage(stage, state, assertLease)),
      ...(prepareStage === undefined
        ? {}
        : {
            prepareStage: (stage, state) => scoped("prepare", () => prepareStage(stage, state)),
          }),
    },
  };
}
