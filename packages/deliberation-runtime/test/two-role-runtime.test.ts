import { defaultKoreanWritingContract } from "@lervo/core";
import type {
  EventEnvelope,
} from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  DeliberationRuntime,
  validateManagedRunContextEvidence,
} from "../src/index.js";
import {
  materializeProposalContext,
  noConsensusOutcome,
} from "./deliberation-scenario.js";
import {
  claimId,
  cleanupFixtures,
  clock,
  coordinator,
  createRuntimeFixture,
  deliberationId,
  hash,
  managedInput,
  objectionId,
  passingEvaluator,
  policy,
  policyVersion,
  projectId,
  proposalDocumentId,
  proposerRole,
  reviewerRole,
  sequence,
} from "./fixture.js";
import { FixtureProviderAdapter } from "./fixture-provider-adapter.js";

afterEach(cleanupFixtures);

describe("same-provider independent role deliberation runtime", () => {
  it("re-loads the proposal in a separate Codex session before recording the review", async () => {
    const fixture = await createRuntimeFixture();
    const now = clock();
    const runtime = new DeliberationRuntime({
      deliberationId,
      policy,
      policyVersion,
      coordinates: {
        projectId,
        runId: "run_deliberation_control",
        sessionId: "ses_deliberation_control",
      },
      events: fixture.events,
      artifactStore: fixture.artifacts,
      now,
      createEventId: sequence("evt_deliberation"),
    });
    runtime.start();

    const proposerAdapter = new FixtureProviderAdapter(
      "codex-session-proposer",
      "설계 결론은 역할마다 독립된 실행 맥락을 사용하는 것입니다. 각 역할은 같은 근거를 직접 읽고 확인합니다.",
    );
    const proposalRun = coordinator({
      fixture,
      adapter: proposerAdapter,
      role: proposerRole,
      runId: "run_proposer_0001",
      sessionId: "ses_proposer_0001",
      now,
    });
    const proposal = await runtime.executeTurn({
      kind: "proposal",
      round: 1,
      details: { claims: [{ claimId, claimDigest: hash("independent-contexts") }] },
      previousArtifactIds: [],
      sharedContextPublications: [],
      executeManagedRun: () => proposalRun.run(managedInput({
        root: fixture.root,
        role: proposerRole,
      })),
      writingContract: defaultKoreanWritingContract,
      semanticEvaluator: passingEvaluator(),
    });

    const { publication, handoff } = await materializeProposalContext({
      root: fixture.root,
      proposal,
      sharedContextId: "scx_deliberation_proposal",
      handoffId: "hnd_proposal_reviewer",
    });
    runtime.publishHandoff({
      artifactId: proposal.artifact.deliberationArtifactId,
      publication,
      handoff,
    });

    const reviewerAdapter = new FixtureProviderAdapter(
      "codex-session-reviewer",
      "검토 결과는 변경 요청입니다. 이전 산출물의 근거와 실제 주입 기록을 연결해야 역할 독립성을 확인할 수 있습니다.",
    );
    const reviewerRun = coordinator({
      fixture,
      adapter: reviewerAdapter,
      role: reviewerRole,
      runId: "run_reviewer_0001",
      sessionId: "ses_reviewer_0001",
      now,
    });
    const review = await runtime.executeTurn({
      kind: "objection",
      round: 1,
      details: {
        reviewStatus: "changes_requested",
        objections: [{
          objectionId,
          objectionDigest: hash("event-evidence-required"),
          targetClaimIds: [claimId],
          blocking: true,
          status: "open",
        }],
      },
      previousArtifactIds: [proposal.artifact.deliberationArtifactId],
      sharedContextPublications: [publication],
      executeManagedRun: () => reviewerRun.run(managedInput({
        root: fixture.root,
        role: reviewerRole,
        includeProposal: true,
        publications: [publication],
        handoff,
      })),
      writingContract: defaultKoreanWritingContract,
      semanticEvaluator: passingEvaluator(),
    });

    runtime.complete(noConsensusOutcome({
      policy,
      proposal,
      review,
      completedAt: now().toISOString(),
    }));

    expect(proposal.artifact.producer).toMatchObject({
      provider: "codex",
      runId: "run_proposer_0001",
      sessionId: "ses_proposer_0001",
    });
    expect(review.artifact.producer).toMatchObject({
      provider: "codex",
      runId: "run_reviewer_0001",
      sessionId: "ses_reviewer_0001",
    });
    expect(proposal.artifact.producer.sessionId).not.toBe(review.artifact.producer.sessionId);
    const providerSessions = eventsOfType(fixture.events.list(), "adapter.started")
      .map((event) => event.payload.providerSessionId);
    expect(new Set(providerSessions).size).toBe(2);
    expect(proposerAdapter.injectedEnvelopes[0]?.writingPolicyDocumentId)
      .toBe("doc_writing_policy");
    expect(reviewerAdapter.injectedEnvelopes[0]?.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: proposalDocumentId,
          contentHash: proposal.artifact.content.contentHash,
        }),
      ]),
    );
    expect(review.artifact.inputContext.sharedContextIds)
      .toEqual([publication.sharedContextId]);
    const proposalReceipts = new Set([
      ...proposal.artifact.inputContext.loadedReceiptIds,
      ...proposal.artifact.inputContext.injectedReceiptIds,
    ]);
    const reviewReceipts = [
      ...review.artifact.inputContext.loadedReceiptIds,
      ...review.artifact.inputContext.injectedReceiptIds,
    ];
    expect(reviewReceipts.some((receiptId) => proposalReceipts.has(receiptId))).toBe(false);

    const events = fixture.events.list();
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded"))
      .toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "deliberation.started",
      "context.published",
      "handoff.created",
      "deliberation.completed",
    ]));
    expect(JSON.stringify(events)).not.toContain(proposal.content);
    expect(JSON.stringify(events)).not.toContain(review.content);
    expect(fixture.events.verifyIntegrity().valid).toBe(true);
    fixture.events.close();
  });

  it("rejects a receipt that is not present in the managed event originals", async () => {
    const fixture = await createRuntimeFixture();
    const now = clock();
    const adapter = new FixtureProviderAdapter(
      "codex-session-proposer",
      "설계 결론을 기록했습니다. 각 역할은 같은 원문을 별도로 읽고 검증합니다.",
    );
    const run = await coordinator({
      fixture,
      adapter,
      role: proposerRole,
      runId: "run_proposer_0001",
      sessionId: "ses_proposer_0001",
      now,
    }).run(managedInput({ root: fixture.root, role: proposerRole }));
    const tampered = structuredClone(run);
    const loaded = tampered.contextEvidence.find((evidence) => evidence.state === "loaded");
    if (loaded === undefined) throw new Error("fixture E2 receipt missing");
    loaded.receiptId = "ctx_forged_receipt_0001";

    expect(() => validateManagedRunContextEvidence({
      run: tampered,
      events: fixture.events.list({ runId: run.session.runId }),
      previousArtifacts: [],
      sharedContextPublications: [],
    })).toThrowError(expect.objectContaining({
      code: "context_evidence_invalid",
      reason: "receipt_event_mismatch",
    }));
    fixture.events.close();
  });
});

function eventsOfType(
  events: readonly EventEnvelope[],
  type: string,
) {
  return events.filter((event) => event.type === type);
}
