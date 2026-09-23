import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  claimAssignment,
  createKnowledgeJobAssignment,
  registerAgent,
} from "@lervo/agent-workforce";
import { FileSystemCas } from "@lervo/cas";
import type { EventDraftV3 } from "@lervo/event-contract";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import type { NoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";
import { resolveRoleContract } from "@lervo/roles";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runLeasedConversationKnowledgeReview } from "../src/conversation-knowledge-review-agent.js";
import {
  CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
  conversationKnowledgeJobId,
  reconcileConversationKnowledgeOutbox,
} from "../src/conversation-knowledge-outbox-reconciliation.js";
import {
  compareRepositoryWork,
  observeRepositoryWork,
} from "../src/repository-work-observation.js";
import { prepareRepositoryWorkSourceManifest } from "../src/repository-work-source-manifest.js";

const execute = promisify(execFile);
const roots: string[] = [];
const projectId = "prj_knowledge_review_agent_01";
const hash = `sha256:${"a".repeat(64)}`;
const instruction = "# Instructions\nReview durable repository knowledge.\n";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-review-agent-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId }));
  await execute("git", ["init", "-b", "main"], { cwd: root });
  await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
  await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
  await writeFile(resolve(root, "README.md"), "before\n");
  await writeFile(resolve(root, "AGENTS.md"), instruction);
  await execute("git", ["add", "-A"], { cwd: root });
  await execute("git", ["commit", "-m", "initial"], { cwd: root });

  const events = await SQLiteEventStore.open({
    path: resolve(root, ".lervo/data/review-events.sqlite"),
    projectId,
    writableEventSchemaVersion: 3,
  });
  const artifacts = await FileSystemCas.open(resolve(root, ".lervo/data/review-cas"));
  const before = await observeRepositoryWork(root);
  await writeFile(resolve(root, "README.md"), "after\n");
  const after = await observeRepositoryWork(root);
  const change = await compareRepositoryWork({ repositoryRoot: root, before, after });
  const source = prepareRepositoryWorkSourceManifest({ before, after, change });
  await artifacts.put(source.content);
  const claimedAt = new Date().toISOString();
  const completedAt = new Date(Date.parse(claimedAt) - 1000).toISOString();
  const completion = events.append({
    eventId: "evt_knowledge_review_agent_completion_01",
    projectId,
    runId: "run_knowledge_review_agent_01",
    sessionId: "ses_knowledge_review_agent_01",
    type: "conversation.repository_work.completed",
    occurredAt: completedAt,
    actor: { kind: "agent", provider: "codex" },
    schemaVersion: 3,
    policyVersion: hash,
    payload: {
      sourceConversationEventId: `cve_${"b".repeat(64)}`,
      workerAgentId: `agt_${"c".repeat(24)}`,
      providerSessionDigest: hash,
      requestedModel: null,
      requestedReasoningEffort: null,
      executionProfile: null,
      allocationReason: "configured_default",
      requestContentHash: hash,
      resultContentHash: hash,
      resultByteCount: 4,
      repositoryRevisionBefore: change.repositoryRevisionBefore,
      repositoryRevisionAfter: change.repositoryRevisionAfter,
      changedPaths: change.changedPaths,
      changedPathCount: 1,
      workstreamId: `wks_${"d".repeat(24)}`,
      workstreamRevision: 1,
      workstreamSnapshotHash: hash,
      knowledgeDisposition: "pending_background",
      sourceManifestContentHash: source.contentHash,
      sourceManifestByteCount: source.content.byteLength,
      checkpointDisposition: "provider_checkpoint",
      replicaDisposition: "not_configured",
      verificationStatus: "passed",
      completedAt,
    },
  } as EventDraftV3).event;
  reconcileConversationKnowledgeOutbox({ events, afterSeq: 0, now: claimedAt });
  const claimed = events.claim({
    destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
    workerId: "knowledge-review-agent-1",
    claimedAt,
    leaseDurationMs: 5 * 60_000,
  })[0]!;

  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["README.md"],
  });
  const role = await resolveRoleContract(root, "developer");
  const assignment = await createKnowledgeJobAssignment({
    repositoryRoot: root,
    taskType: "repository.knowledge.review",
    roleId: "developer",
    roleVersion: role.version,
    roleContractHash: role.contractHash,
    requiredCapabilityHash: agent.capabilityHash,
    priority: 30,
    dependencyIds: [],
    acceptanceCriteria: ["Review source-bound knowledge without changing repository files."],
    verificationSuiteIds: ["knowledge.lifecycle"],
    approvalRequirements: [],
    expectedPaths: ["README.md"],
    workstreamId: `wks_${"d".repeat(24)}`,
    knowledgeJob: {
      contractVersion: 1,
      jobId: conversationKnowledgeJobId(completion.eventId),
      completionEventId: completion.eventId,
      completionEventHash: completion.eventHash,
      sourceConversationEventId: String(completion.payload.sourceConversationEventId),
      sourceManifestHash: source.contentHash,
      agentId: agent.agentId,
    },
  });
  const leased = await claimAssignment({
    repositoryRoot: root,
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_knowledge_review_owner_01",
    leaseDurationMs: 5 * 60_000,
    now: new Date(claimedAt),
  });
  const input = {
    events,
    artifacts,
    repositoryRoot: root,
    claimed,
    workerId: "knowledge-review-agent-1",
    now: () => new Date(Date.parse(claimedAt) + 1000).toISOString(),
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    assignmentLeaseId: leased.lease!.leaseId,
    provider: "codex" as const,
    verificationSuiteIds: ["knowledge.lifecycle"],
  };
  return { root, events, claimed, input };
}

function runner(effect?: () => Promise<void>) {
  const resolveObserved = vi.fn(async (_request: unknown) => {
    await effect?.();
    return {
      value: {
        schemaVersion: 1,
        classification: "canonical_change_candidate",
        rationale: "The changed behavior creates a durable canonical documentation obligation.",
        evidencePaths: ["README.md"],
        targetPaths: ["docs/product/vision.md"],
      },
      usage: {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 40,
        reasoningOutputTokens: 10,
        totalTokens: 140,
        contextWindow: 200_000,
      },
    };
  });
  const openRunner = vi.fn(
    async () =>
      ({
        provider: "codex",
        resolve: async () => ({}),
        resolveObserved,
      }) satisfies NoCapabilityProviderJsonRunner,
  );
  return { openRunner, resolveObserved };
}

describe("leased conversation knowledge review agent", () => {
  it("checks both leases and produces only a source-bound review candidate", async () => {
    const f = await fixture();
    const provider = runner();
    expect(
      await runLeasedConversationKnowledgeReview({ ...f.input, openRunner: provider.openRunner }),
    ).toMatchObject({
      status: "candidate",
      review: { decision: { classification: "canonical_change_candidate" } },
    });
    expect(provider.resolveObserved).toHaveBeenCalledOnce();
    expect(provider.resolveObserved.mock.calls[0]?.[0]).toMatchObject({
      untrustedSourceData: {
        context: [{ path: "AGENTS.md", role: "instruction", content: instruction }],
      },
    });
    f.events.close();
  });

  it("does not invoke a provider when required canonical instructions are unavailable", async () => {
    const f = await fixture();
    await rm(resolve(f.root, "AGENTS.md"));
    const provider = runner();
    expect(
      await runLeasedConversationKnowledgeReview({ ...f.input, openRunner: provider.openRunner }),
    ).toMatchObject({
      status: "needs_review",
      reasonCode: "review_context_unavailable",
    });
    expect(provider.openRunner).not.toHaveBeenCalled();
    f.events.close();
  });

  it("rejects a changed review-assignment scope before disclosing source bytes", async () => {
    const f = await fixture();
    const provider = runner();
    await expect(
      runLeasedConversationKnowledgeReview({
        ...f.input,
        verificationSuiteIds: ["project.quick"],
        openRunner: provider.openRunner,
      }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    expect(provider.openRunner).not.toHaveBeenCalled();
    f.events.close();
  });

  it("discards a provider candidate when canonical instruction bytes change during review", async () => {
    const f = await fixture();
    const provider = runner(() =>
      writeFile(resolve(f.root, "AGENTS.md"), "# Changed after provider start\n"),
    );
    expect(
      await runLeasedConversationKnowledgeReview({ ...f.input, openRunner: provider.openRunner }),
    ).toMatchObject({ status: "needs_review", reasonCode: "review_context_stale" });
    f.events.close();
  });

  it("discards a provider candidate when the source changed during review", async () => {
    const f = await fixture();
    const provider = runner(() => writeFile(resolve(f.root, "README.md"), "later\n"));
    expect(
      await runLeasedConversationKnowledgeReview({ ...f.input, openRunner: provider.openRunner }),
    ).toMatchObject({
      status: "stale",
      reasonCode: "source_bytes_changed",
    });
    f.events.close();
  });

  it("rejects a reclaimed outbox lease after the provider response", async () => {
    const f = await fixture();
    const provider = runner(async () => {
      f.events.reschedule({
        eventId: f.claimed.event.eventId,
        destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
        workerId: "knowledge-review-agent-1",
        failedAt: f.input.now(),
        availableAt: new Date(Date.parse(f.input.now()) + 1000).toISOString(),
        failureCode: "review_retry",
      });
    });
    await expect(
      runLeasedConversationKnowledgeReview({ ...f.input, openRunner: provider.openRunner }),
    ).rejects.toMatchObject({ code: "knowledge_job_lease_conflict" });
    f.events.close();
  });
});
