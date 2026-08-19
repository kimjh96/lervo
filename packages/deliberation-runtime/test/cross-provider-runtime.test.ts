import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import { defaultKoreanWritingContract } from "@lervo/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeliberationRuntime } from "../src/index.js";
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
  policyVersion,
  policyWithProviders,
  projectId,
  proposalDocumentId,
  proposerRole,
  reviewerRole,
  sequence,
} from "./fixture.js";
import {
  DeliberationClaudeClient,
  DeliberationCodexClient,
} from "./fixture-real-adapters.js";

const CLAUDE_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CLAUDE_TURN_ID = "22222222-2222-4222-8222-222222222222";
const CLAUDE_RESULT_ID = "44444444-4444-4444-8444-444444444444";

afterEach(cleanupFixtures);

describe("cross-provider deliberation runtime", () => {
  it("reloads a Codex proposal into an independent Claude review session", async () => {
    const fixture = await createRuntimeFixture();
    const now = clock();
    const policy = policyWithProviders("codex", "claude");
    const runtime = new DeliberationRuntime({
      deliberationId,
      policy,
      policyVersion,
      coordinates: {
        projectId,
        runId: "run_cross_provider_control",
        sessionId: "ses_cross_provider_control",
      },
      events: fixture.events,
      artifactStore: fixture.artifacts,
      now,
      createEventId: sequence("evt_cross_provider"),
    });
    runtime.start();

    const proposalContent =
      "제안은 공급자와 무관한 공통 산출물을 공유하는 것입니다. 검토자는 이 원문과 근거를 별도 세션에서 다시 읽습니다.";
    const codexClient = new DeliberationCodexClient(
      "codex-thread-proposer",
      "codex-turn-proposer",
      proposalContent,
    );
    const proposalRun = coordinator({
      fixture,
      adapter: new CodexAdapter({
        repositoryRoot: fixture.root,
        clientFactory: async () => codexClient,
        resolveArtifact: (uri) => fixture.artifacts.get(uri),
        now,
        createEventId: sequence("evt_codex_cross"),
        createReceiptId: sequence("ctx_codex_cross"),
      }),
      role: proposerRole,
      runId: "run_cross_proposer",
      sessionId: "ses_cross_proposer",
      now,
    });
    const proposal = await runtime.executeTurn({
      kind: "proposal",
      round: 1,
      details: { claims: [{ claimId, claimDigest: hash("provider-neutral-artifact") }] },
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
      sharedContextId: "scx_cross_provider_proposal",
      handoffId: "hnd_cross_provider_review",
    });
    runtime.publishHandoff({
      artifactId: proposal.artifact.deliberationArtifactId,
      publication,
      handoff,
    });

    const reviewContent =
      "검토 결과는 변경 요청입니다. 공유 원문의 해시와 실제 주입 증거가 연결되어야 공급자 간 검토를 신뢰할 수 있습니다.";
    const claudeClient = new DeliberationClaudeClient(
      CLAUDE_SESSION_ID,
      CLAUDE_RESULT_ID,
      reviewContent,
    );
    const reviewRun = coordinator({
      fixture,
      adapter: new ClaudeAdapter({
        repositoryRoot: fixture.root,
        clientFactory: async () => claudeClient,
        resolveArtifact: (uri) => fixture.artifacts.get(uri),
        now,
        createProviderSessionId: () => CLAUDE_SESSION_ID,
        createProviderMessageId: () => CLAUDE_TURN_ID,
        createEventId: sequence("evt_claude_cross"),
        createReceiptId: sequence("ctx_claude_cross"),
      }),
      role: reviewerRole,
      runId: "run_cross_reviewer",
      sessionId: "ses_cross_reviewer",
      now,
    });
    const review = await runtime.executeTurn({
      kind: "objection",
      round: 1,
      details: {
        reviewStatus: "changes_requested",
        objections: [{
          objectionId,
          objectionDigest: hash("cross-provider-evidence-required"),
          targetClaimIds: [claimId],
          blocking: true,
          status: "open",
        }],
      },
      previousArtifactIds: [proposal.artifact.deliberationArtifactId],
      sharedContextPublications: [publication],
      executeManagedRun: () => reviewRun.run(managedInput({
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
      roleId: "proposer",
    });
    expect(review.artifact.producer).toMatchObject({
      provider: "claude",
      roleId: "reviewer",
    });
    expect(codexClient.startOptions).toMatchObject({
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    const claudeContext = JSON.parse(claudeClient.appendedContexts[0] ?? "null") as {
      documents?: Array<{ documentId: string; contentHash: string; content: string }>;
    };
    expect(claudeContext.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        documentId: proposalDocumentId,
        contentHash: proposal.artifact.content.contentHash,
        content: proposalContent,
      }),
    ]));
    expect(review.artifact.inputContext.sharedContextIds).toEqual([
      publication.sharedContextId,
    ]);
    expect(codexClient.injectedItems).toHaveLength(1);
    expect(codexClient.closed).toBe(true);
    expect(claudeClient.closed).toBe(true);

    const events = fixture.events.list();
    const startEvents = events.filter((event) => event.type === "adapter.started");
    const starts = startEvents.map((event) => event.payload);
    expect(startEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: { kind: "provider", provider: "codex" } }),
      expect.objectContaining({ actor: { kind: "provider", provider: "claude" } }),
    ]));
    expect(starts).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapterId: "lervo/codex" }),
      expect.objectContaining({ adapterId: "lervo/claude" }),
    ]));
    expect(new Set(starts.map((payload) => payload.providerSessionId)).size).toBe(2);
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded"))
      .toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(proposalContent);
    expect(JSON.stringify(events)).not.toContain(reviewContent);
    expect(fixture.events.verifyIntegrity().valid).toBe(true);
    fixture.events.close();
  });

  it("rejects a provider that is not assigned to the role before writing evaluation", async () => {
    const fixture = await createRuntimeFixture();
    const now = clock();
    const policy = policyWithProviders("codex", "claude");
    const runtime = new DeliberationRuntime({
      deliberationId,
      policy,
      policyVersion,
      coordinates: {
        projectId,
        runId: "run_provider_policy_control",
        sessionId: "ses_provider_policy_control",
      },
      events: fixture.events,
      artifactStore: fixture.artifacts,
      now,
      createEventId: sequence("evt_provider_policy"),
    });
    runtime.start();
    const claudeClient = new DeliberationClaudeClient(
      CLAUDE_SESSION_ID,
      CLAUDE_RESULT_ID,
      "이 결과는 제안자 역할에 배정되지 않은 공급자가 만들었습니다.",
    );
    const run = coordinator({
      fixture,
      adapter: new ClaudeAdapter({
        repositoryRoot: fixture.root,
        clientFactory: async () => claudeClient,
        now,
        createProviderSessionId: () => CLAUDE_SESSION_ID,
        createProviderMessageId: () => CLAUDE_TURN_ID,
        createEventId: sequence("evt_claude_wrong_role"),
        createReceiptId: sequence("ctx_claude_wrong_role"),
      }),
      role: proposerRole,
      runId: "run_wrong_provider",
      sessionId: "ses_wrong_provider",
      now,
    });
    const evaluate = vi.fn(async () => {
      throw new Error("writing evaluation must not run");
    });

    await expect(runtime.executeTurn({
      kind: "proposal",
      round: 1,
      details: { claims: [{ claimId, claimDigest: hash("wrong-provider") }] },
      previousArtifactIds: [],
      sharedContextPublications: [],
      executeManagedRun: () => run.run(managedInput({
        root: fixture.root,
        role: proposerRole,
      })),
      writingContract: defaultKoreanWritingContract,
      semanticEvaluator: { evaluate },
    })).rejects.toMatchObject({
      code: "artifact_publication_failed",
      reason: "provider_not_allowed",
    });

    expect(evaluate).not.toHaveBeenCalled();
    expect(runtime.history()).toEqual([]);
    expect(fixture.events.list().map((event) => event.type))
      .not.toContain("deliberation.artifact.recorded");
    expect(claudeClient.closed).toBe(true);
    expect(fixture.events.verifyIntegrity().valid).toBe(true);
    fixture.events.close();
  });
});
