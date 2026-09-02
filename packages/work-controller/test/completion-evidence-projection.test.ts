import { describe, expect, it } from "vitest";

import {
  completionEvidenceId,
  projectCompletionEvidence,
  projectManagedAttempts,
} from "../src/index.js";
import { assignment, causalityPayload, event, workstreamId } from "./fixtures.js";

describe("assignment completion evidence projection", () => {
  it("binds accepted completion evidence to the exact managed result", () => {
    const node = assignment("1");
    const runId = "run_111111111111111111111111";
    const sessionId = "ses_111111111111111111111111";
    const resultContentHash = `sha256:${"a".repeat(64)}`;
    const resultArtifactId = `art_${"a".repeat(64)}`;
    const preparedAt = "2026-09-01T00:00:03.000Z";
    const coordinate = {
      workstreamId,
      assignmentId: node.assignmentId,
      assignmentRevision: 2,
      agentId: "agt_111111111111111111111111",
      leaseId: "lse_111111111111111111111111",
      runId,
      sessionId,
      resultArtifactId,
      resultContentHash,
      preparedAt,
    };
    const events = [
      event(
        1,
        "work.causality.recorded",
        runId,
        causalityPayload({ assignmentId: node.assignmentId }),
      ),
      event(2, "run.completed", runId, {
        resultDigest: resultContentHash,
        artifactIds: [resultArtifactId, "art_verification_result_01"],
        verificationStatus: "passed",
      }),
      event(3, "assignment.completion.prepared", runId, {
        completionEvidenceId: completionEvidenceId(coordinate),
        workstreamId,
        assignmentId: node.assignmentId,
        assignmentRevision: 2,
        agentId: coordinate.agentId,
        leaseId: coordinate.leaseId,
        resultArtifactId,
        resultContentHash,
        verificationStatus: "passed",
        writingPublicationStatus: "allowed",
        preparedAt,
      }),
    ];
    const attempts = projectManagedAttempts({ events, workstreamId }).attempts;

    expect(projectCompletionEvidence({ events, attempts, workstreamId })).toEqual([
      { schemaVersion: 1, completionEvidenceId: completionEvidenceId(coordinate), ...coordinate },
    ]);
  });

  it("rejects evidence whose artifact differs from the completed run", () => {
    const node = assignment("1");
    const runId = "run_111111111111111111111111";
    const events = [
      event(
        1,
        "work.causality.recorded",
        runId,
        causalityPayload({ assignmentId: node.assignmentId }),
      ),
      event(2, "run.completed", runId, {
        resultDigest: `sha256:${"a".repeat(64)}`,
        artifactIds: [`art_${"a".repeat(64)}`, "art_verification_result_01"],
        verificationStatus: "passed",
      }),
      event(3, "assignment.completion.prepared", runId, {
        completionEvidenceId: `acp_${"1".repeat(24)}`,
        workstreamId,
        assignmentId: node.assignmentId,
        assignmentRevision: 2,
        agentId: "agt_111111111111111111111111",
        leaseId: "lse_111111111111111111111111",
        resultArtifactId: `art_${"b".repeat(64)}`,
        resultContentHash: `sha256:${"b".repeat(64)}`,
        verificationStatus: "passed",
        writingPublicationStatus: "allowed",
        preparedAt: "2026-09-01T00:00:03.000Z",
      }),
    ];
    const attempts = projectManagedAttempts({ events, workstreamId }).attempts;

    expect(() => projectCompletionEvidence({ events, attempts, workstreamId })).toThrow(
      "differs from the run result",
    );
  });
});
