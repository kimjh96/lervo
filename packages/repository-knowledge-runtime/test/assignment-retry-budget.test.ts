import { describe, expect, it } from "vitest";
import type { WorkforceAssignment } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import {
  CONVERGENCE_ASSIGNMENT_ATTEMPT_LIMIT,
  retryConvergenceAssignment,
} from "../src/assignment-failure.js";
import { convergenceEvaluationContract } from "../src/evaluation-contract.js";

function exhausted(proof: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(canonicalJson(proof));
  const storage = {
    artifacts: { get: async () => bytes },
    // No terminal event: a retry that passes the budget then stops at its evidence check.
    events: { list: () => [] },
  } as unknown as ProjectStorage;
  const assignment = {
    assignmentId: "asn_0123456789abcdef01234567",
    status: "failed",
    lease: null,
    convergence: { obligationId: "kconv_0123456789abcdef01234567" },
    recovery: { attemptNumber: CONVERGENCE_ASSIGNMENT_ATTEMPT_LIMIT },
    resultArtifacts: [{ artifactId: "art_0123456789", contentHash: sha256(bytes) }],
  } as unknown as WorkforceAssignment;
  return retryConvergenceAssignment(storage, assignment);
}

describe("convergence assignment retry budget", () => {
  it("stops an exhausted assignment whose last failure the current logic judged", async () => {
    await expect(
      exhausted({
        kind: "convergence_assignment_failure",
        evaluationContract: convergenceEvaluationContract(),
      }),
    ).rejects.toMatchObject({ code: "knowledge_retry_exhausted" });
  });

  it("grants new logic one attempt past a budget that earlier logic used up", async () => {
    for (const evaluationContract of [undefined, "lervo.knowledge-stage-failure.v1:earlier"])
      await expect(
        exhausted({ kind: "convergence_assignment_failure", evaluationContract }),
      ).rejects.toMatchObject({ code: "knowledge_effect_uncertain" });
  });
});
