import { createDoctorReport } from "@lervo/diagnostics";
import type { EventEnvelope } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  convergedHistory,
  objectionId,
  outcome,
  policy,
} from "../../deliberation/test/fixtures.js";
import {
  createKnowledgeCandidates,
  knowledgeCandidateBytes,
} from "../src/index.js";
import {
  createCandidateFixture,
  policyVersion,
  removeStores,
  sequence,
  stores,
} from "./fixture.js";

afterEach(removeStores);

describe("knowledge candidate creation", () => {
  it("creates one CAS-backed candidate per adopted claim from event-bound convergence", async () => {
    const { storage, history, decision, result, outcomeEvent, created } =
      await createCandidateFixture();

    expect(created.candidate).toMatchObject({
      status: "candidate",
      source: {
        kind: "converged_deliberation",
        outcomeId: result.outcomeId,
        decisionArtifactId: decision.deliberationArtifactId,
      },
      paths: ["src/decision.ts"],
      verifiedRevision: history.evidence.result.repositoryRevision,
    });
    const bytes = await storage.artifacts.get(created!.candidateArtifact.uri);
    expect(bytes).toEqual(knowledgeCandidateBytes(created!.candidate));
    expect(created.recordedEvent.payload).toMatchObject({
      candidateId: created.candidate.candidateId,
      sourceOutcomeId: result.outcomeId,
      candidateContentHash: created.candidateArtifact.contentHash,
    });
    expect(JSON.stringify(storage.events.list())).not.toContain("decision:lead:2:6");
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    await expect(createDoctorReport({
      projectId: policy.projectId,
      events: storage.events,
      artifacts: storage.artifacts,
    })).resolves.toMatchObject({ status: "healthy", issues: [] });

    await expect(createKnowledgeCandidates({
      deliberationId: result.deliberationId,
      policy,
      artifacts: history.artifacts,
      verificationEvidence: [history.evidence],
      outcome: result,
      outcomeEvent,
      pathsByClaimId: { clm_architecture_0001: ["src/decision.ts"] },
      reviewIntervalDays: 30,
      policyVersion,
      events: storage.events,
      artifactStore: storage.artifacts,
      createEventId: sequence("evt_duplicate"),
    })).rejects.toMatchObject({
      code: "candidate_contract_invalid",
      reason: "candidate_already_recorded",
    });
    storage.events.close();
  });

  it.each(["no_consensus", "failed"] as const)(
    "does not turn a %s outcome into a knowledge candidate",
    async (status) => {
      const storage = await stores();
      const history = convergedHistory();
      const artifacts = status === "no_consensus" ? history.artifacts.slice(0, 2) : [];
      const result = outcome({
        artifacts,
        status,
        ...(status === "no_consensus"
          ? {
              reason: "blocking_objections_unresolved" as const,
              unresolvedBlockingObjectionIds: [objectionId],
            }
          : {}),
      });

      await expect(createKnowledgeCandidates({
        deliberationId: result.deliberationId,
        policy,
        artifacts,
        verificationEvidence: [],
        outcome: result,
        outcomeEvent: {} as EventEnvelope,
        pathsByClaimId: {},
        reviewIntervalDays: 30,
        policyVersion,
        events: storage.events,
        artifactStore: storage.artifacts,
        createEventId: sequence("evt_ineligible"),
      })).rejects.toMatchObject({
        code: "candidate_not_eligible",
        reason: "outcome_not_converged",
      });
      expect(storage.events.list()).toEqual([]);
      storage.events.close();
    },
  );
});
