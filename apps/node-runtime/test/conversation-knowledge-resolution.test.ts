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
import { resolveRoleContract } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
  conversationKnowledgeJobId,
  reconcileConversationKnowledgeOutbox,
} from "../src/conversation-knowledge-outbox-reconciliation.js";
import { resolveLeasedConversationKnowledgeFailure } from "../src/conversation-knowledge-resolution.js";
import {
  compareRepositoryWork,
  observeRepositoryWork,
} from "../src/repository-work-observation.js";
import { prepareRepositoryWorkSourceManifest } from "../src/repository-work-source-manifest.js";

const execute = promisify(execFile);
const roots: string[] = [];
const projectId = "prj_knowledge_resolution_01";
const hash = `sha256:${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-resolution-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId }));
  await execute("git", ["init", "-b", "main"], { cwd: root });
  await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
  await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
  await writeFile(resolve(root, "README.md"), "before\n");
  await execute("git", ["add", "-A"], { cwd: root });
  await execute("git", ["commit", "-m", "initial"], { cwd: root });

  const before = await observeRepositoryWork(root);
  await writeFile(resolve(root, "README.md"), "after\n");
  const after = await observeRepositoryWork(root);
  const change = await compareRepositoryWork({ repositoryRoot: root, before, after });
  const source = prepareRepositoryWorkSourceManifest({ before, after, change });
  const artifacts = await FileSystemCas.open(resolve(root, ".lervo/data/resolution-cas"));
  await artifacts.put(source.content);
  const eventPath = resolve(root, ".lervo/data/resolution-events.sqlite");
  const events = await SQLiteEventStore.open({
    path: eventPath,
    projectId,
    writableEventSchemaVersion: 3,
  });
  const claimedAt = new Date().toISOString();
  const completedAt = new Date(Date.parse(claimedAt) - 1_000).toISOString();
  const completion = events.append({
    eventId: "evt_knowledge_resolution_completion_01",
    projectId,
    runId: "run_knowledge_resolution_01",
    sessionId: "ses_knowledge_resolution_01",
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
  } satisfies EventDraftV3).event;
  reconcileConversationKnowledgeOutbox({ events, afterSeq: 0, now: claimedAt });
  const workerId = "knowledge-resolution-worker-1";
  const claimed = events.claim({
    destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
    workerId,
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
    acceptanceCriteria: ["Resolve exact source-bound knowledge without claiming currency."],
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
    sessionId: "ses_knowledge_resolution_owner_01",
    leaseDurationMs: 5 * 60_000,
    now: new Date(claimedAt),
  });
  const input = {
    events,
    artifacts,
    repositoryRoot: root,
    claimed,
    workerId,
    now: () => new Date(Date.parse(claimedAt) + 1_000).toISOString(),
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    assignmentLeaseId: leased.lease!.leaseId,
    provider: "codex" as const,
    verificationSuiteIds: ["knowledge.lifecycle"],
    terminalState: "attention_required" as const,
    failureCode: "review_context_unavailable",
  };
  return { root, eventPath, events, completion, claimed, input };
}

describe("conversation knowledge non-success resolution", () => {
  it("atomically records one private failure and acknowledges the exact queue lease", async () => {
    const f = await fixture();
    const result = await resolveLeasedConversationKnowledgeFailure(f.input);
    expect(result).toMatchObject({
      inserted: true,
      event: {
        type: "conversation.repository_knowledge.resolved",
        payload: {
          completionEventId: f.completion.eventId,
          agentId: f.input.agentId,
          terminalState: "attention_required",
          failureCode: "review_context_unavailable",
          knowledgeSnapshotHash: null,
        },
      },
    });
    expect(result.event.payload.agentId).not.toBe(f.completion.payload.workerAgentId);
    expect(
      f.events.getOutbox(f.completion.eventId, CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION),
    ).toMatchObject({ status: "acknowledged" });
    expect(
      reconcileConversationKnowledgeOutbox({ events: f.events, afterSeq: 0, now: f.input.now() }),
    ).toMatchObject({ enqueuedCount: 0, outstandingCount: 0 });
    await expect(resolveLeasedConversationKnowledgeFailure(f.input)).rejects.toMatchObject({
      code: "knowledge_job_lease_conflict",
    });
    f.events.close();
  });

  it("requires observed source drift before recording stale", async () => {
    const f = await fixture();
    const stale = {
      ...f.input,
      terminalState: "stale" as const,
      failureCode: "source_bytes_changed",
    };
    await expect(resolveLeasedConversationKnowledgeFailure(stale)).rejects.toMatchObject({
      code: "knowledge_resolution_invalid",
    });
    await writeFile(resolve(f.root, "README.md"), "later\n");
    await expect(resolveLeasedConversationKnowledgeFailure(stale)).resolves.toMatchObject({
      event: { payload: { terminalState: "stale", failureCode: "source_bytes_changed" } },
    });
    f.events.close();
  });

  it("does not misclassify a current source as a source-currency failure", async () => {
    const f = await fixture();
    await expect(
      resolveLeasedConversationKnowledgeFailure({
        ...f.input,
        failureCode: "source_bytes_changed",
      }),
    ).rejects.toMatchObject({ code: "knowledge_resolution_invalid" });
    expect(
      f.events.getOutbox(f.completion.eventId, CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION),
    ).toMatchObject({ status: "leased" });
    expect(
      f.events
        .list({ runId: f.completion.runId })
        .filter((event) => event.type === "conversation.repository_knowledge.resolved"),
    ).toHaveLength(0);
    f.events.close();
  });

  it("requires the exact source-bound agent lease and verification suites", async () => {
    const f = await fixture();
    await expect(
      resolveLeasedConversationKnowledgeFailure({
        ...f.input,
        verificationSuiteIds: ["different.suite"],
      }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    await expect(
      resolveLeasedConversationKnowledgeFailure({
        ...f.input,
        assignmentLeaseId: "les_other",
      }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    expect(
      f.events.getOutbox(f.completion.eventId, CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION),
    ).toMatchObject({ status: "leased" });
    expect(
      f.events
        .list({ runId: f.completion.runId })
        .filter((event) => event.type === "conversation.repository_knowledge.resolved"),
    ).toHaveLength(0);
    f.events.close();
  });

  it("recovers an expired sixteenth lease without leaving the job unresolvable", async () => {
    const f = await fixture();
    await expect(
      resolveLeasedConversationKnowledgeFailure({
        ...f.input,
        failureCode: "knowledge_retry_exhausted",
      }),
    ).rejects.toMatchObject({ code: "knowledge_resolution_invalid" });
    let claimed = f.claimed;
    for (let attempt = 1; attempt <= 16; attempt += 1) {
      f.events.reschedule({
        eventId: f.completion.eventId,
        destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
        workerId: f.input.workerId,
        failedAt: f.input.now(),
        availableAt: f.input.now(),
        failureCode: "review_retry",
      });
      claimed = f.events.claim({
        destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
        workerId: f.input.workerId,
        claimedAt: f.input.now(),
        leaseDurationMs: 5 * 60_000,
      })[0]!;
    }
    expect(claimed.attemptCount).toBe(17);
    await expect(
      resolveLeasedConversationKnowledgeFailure({
        ...f.input,
        claimed,
        failureCode: "knowledge_retry_exhausted",
      }),
    ).resolves.toMatchObject({
      event: {
        payload: {
          terminalState: "attention_required",
          attemptCount: 16,
          failureCode: "knowledge_retry_exhausted",
        },
      },
    });
    expect(
      f.events.getOutbox(f.completion.eventId, CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION),
    ).toMatchObject({ status: "acknowledged", attemptCount: 17 });
    f.events.close();
  });

  it("rolls back the event when the event writer cannot append version 3", async () => {
    const f = await fixture();
    f.events.close();
    const events = await SQLiteEventStore.open({ path: f.eventPath, projectId });
    await expect(
      resolveLeasedConversationKnowledgeFailure({ ...f.input, events }),
    ).rejects.toMatchObject({ code: "event_schema_unsupported" });
    expect(
      events.getOutbox(f.completion.eventId, CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION),
    ).toMatchObject({ status: "leased" });
    expect(
      events
        .list({ runId: f.completion.runId })
        .filter((event) => event.type === "conversation.repository_knowledge.resolved"),
    ).toHaveLength(0);
    events.close();
  });

  it("cannot settle after another worker reclaims its queue lease", async () => {
    const f = await fixture();
    f.events.reschedule({
      eventId: f.claimed.event.eventId,
      destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
      workerId: f.input.workerId,
      failedAt: f.input.now(),
      availableAt: new Date(Date.parse(f.input.now()) + 1_000).toISOString(),
      failureCode: "review_retry",
    });
    await expect(resolveLeasedConversationKnowledgeFailure(f.input)).rejects.toMatchObject({
      code: "knowledge_job_lease_conflict",
    });
    expect(
      f.events
        .list({ runId: f.completion.runId })
        .filter((event) => event.type === "conversation.repository_knowledge.resolved"),
    ).toHaveLength(0);
    f.events.close();
  });
});
