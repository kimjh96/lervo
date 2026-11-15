import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";
import type { ConvergenceDelegation } from "../src/delegation.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";

/**
 * Replaces `withConvergenceAssignment` in stage unit tests: each role is staffed by its own agent,
 * as the delegation's role bindings require, unless a case shares one agent across roles.
 */
export const workforceSeam = {
  delegation: null as ConvergenceDelegation | null,
  sharedAgent: false,
  reset() {
    this.delegation = null;
    this.sharedAgent = false;
  },
  module: {
    withConvergenceAssignment: async (input: {
      role: string;
      run(authority: unknown): Promise<unknown>;
    }) =>
      input.run({
        assignment: { assignmentId: `asn_seam_${input.role}` },
        agent: {
          agentId: workforceSeam.sharedAgent ? "agt_seam_shared" : `agt_seam_${input.role}`,
        },
        delegation: workforceSeam.delegation,
        assertCurrent: async () => {},
      }),
  },
};

/** A decision-only stage context: the source fences are exercised by the effect-fence sweeps. */
export function seamContext(storage: ProjectStorage): ConvergenceRuntimeContext {
  return {
    storage,
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSourceExact: () => {},
    assertSourceCurrent: () => {},
  };
}

export function obligationInput(
  obligationId: string,
  baseline: KnowledgeConvergenceInput["baseline"],
): KnowledgeConvergenceInput {
  return {
    schemaVersion: 1,
    obligationId,
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    stageData: {},
    receipts: [],
  };
}
