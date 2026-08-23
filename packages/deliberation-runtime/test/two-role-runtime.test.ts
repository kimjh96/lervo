import { defaultEnglishWritingContract } from "@lervo/core";
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
  it("records an artifact when run completion is beyond the event store default page", async () => {
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
    const adapter = new FixtureProviderAdapter(
      "codex-session-proposer",
      "Inspect the completed execution source regardless of pagination defaults.",
      120,
    );
    const proposal = await runtime.executeTurn({
      kind: "proposal",
      round: 1,
      details: { claims: [{ claimId, claimDigest: hash("bounded-run-events") }] },
      previousArtifactIds: [],
      sharedContextPublications: [],
      executeManagedRun: () => coordinator({
        fixture,
        adapter,
        role: proposerRole,
        runId: "run_proposer_many_events",
        sessionId: "ses_proposer_many_events",
        now,
      }).run(managedInput({ root: fixture.root, role: proposerRole })),
      writingContract: defaultEnglishWritingContract,
      semanticEvaluator: passingEvaluator(),
    });

    const runEvents = fixture.events.list({ runId: "run_proposer_many_events", limit: 1_000 });
    expect(runEvents.length).toBeGreaterThan(100);
    expect(runEvents.findIndex((event) => event.type === "run.completed")).toBeGreaterThan(99);
    expect(proposal.artifact.producer.runId).toBe("run_proposer_many_events");
    fixture.events.close();
  });

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
      "The design conclusion uses an independent execution context for each role. Every role reads and checks the same evidence directly.",
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
      writingContract: defaultEnglishWritingContract,
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
    const proposerHandoff = {
      ...structuredClone(handoff),
      handoffId: "hnd_proposal_proposer",
      toRoleId: "proposer",
    };
    runtime.publishHandoff({
      artifactId: proposal.artifact.deliberationArtifactId,
      publication,
      handoff: proposerHandoff,
    });
    expect(() => runtime.publishHandoff({
      artifactId: proposal.artifact.deliberationArtifactId,
      publication,
      handoff: proposerHandoff,
    })).toThrowError(expect.objectContaining({
      code: "runtime_state_invalid",
      reason: "handoff_already_published",
    }));

    const reviewerAdapter = new FixtureProviderAdapter(
      "codex-session-reviewer",
      "The review requests changes. Evidence for the prior artifact must be linked to actual injection records to verify role independence.",
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
      writingContract: defaultEnglishWritingContract,
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
    expect(events.filter((event) => event.type === "context.published")).toHaveLength(1);
    expect(events.filter((event) => event.type === "handoff.created")).toHaveLength(2);
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
      "Recorded the design conclusion. Each role reads and verifies the same source independently.",
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
