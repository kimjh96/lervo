import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { calculateConversationDeliberationOriginBindingDigest } from "../../../packages/conversation-deliberation-contract/dist/index.js";
import { SQLiteConversationDeliberationJobStore } from "../../../packages/conversation-deliberation-sqlite/dist/index.js";
import {
  calculateDeliberationOutcomeId,
  deliberationPolicyHash,
} from "../../../packages/deliberation/dist/index.js";
import { openProjectStorage } from "../../../packages/project-storage/dist/index.js";

function parsed(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function prepareDeliberationFixture(consumerRoot, projectId, terminal) {
  const fixtureKind = terminal ? "terminal" : "active";
  const deliberationId = `dlb_packed_host_${fixtureKind}_01`;
  const integrationId = `itg_packed_host_${fixtureKind}_01`;
  const sourceEventId = `cve_${(terminal ? "b" : "a").repeat(64)}`;
  const occurredAt = "2026-09-17T00:00:00.000Z";
  const completedAt = "2026-09-17T00:00:01.000Z";
  const policy = {
    schemaVersion: 1,
    policyId: `deliberation_packed-host-${fixtureKind}`,
    projectId,
    participants: [
      {
        roleId: "architect",
        responsibilities: ["proposer", "reviewer"],
        providerSelection: { mode: "fixed", provider: "codex" },
      },
      {
        roleId: "reviewer",
        responsibilities: ["reviewer"],
        providerSelection: { mode: "fixed", provider: "claude" },
      },
      {
        roleId: "verifier",
        responsibilities: ["verifier"],
        providerSelection: { mode: "allowlist", providers: ["codex", "claude"] },
      },
      {
        roleId: "lead",
        responsibilities: ["decision_owner"],
        providerSelection: { mode: "fixed", provider: "codex" },
      },
    ],
    decisionOwnerRoleId: "lead",
    maxRounds: 3,
    requiredVerificationSuiteIds: ["packed.host"],
    convergence: {
      requireIndependentReviewer: true,
      requireIndependentSessions: true,
      requireDecisionOwnerDecision: true,
      requirePassedVerifications: true,
      requireZeroUnresolvedBlockingObjections: true,
      unresolvedBlockingDisposition: "no_consensus",
    },
    publication: {
      surface: "documentation",
      writingPolicyId: "writing_en-human",
      writingPolicyHash: sha256("packed writing policy"),
      requiresWritingPermit: true,
    },
  };
  const storage = await openProjectStorage(consumerRoot);
  try {
    storage.events.append({
      eventId: `evt_packed_deliberation_${fixtureKind}_started`,
      projectId,
      runId: "run_packed_deliberation_root",
      sessionId: "ses_packed_deliberation_root",
      type: "deliberation.started",
      occurredAt,
      actor: { kind: "system" },
      schemaVersion: storage.writableEventSchemaVersion ?? 1,
      policyVersion: sha256("packed event policy"),
      payload: {
        deliberationId,
        policyId: policy.policyId,
        policyHash: deliberationPolicyHash(policy),
        participantRoleIds: policy.participants.map((participant) => participant.roleId),
        maxRounds: policy.maxRounds,
        policy,
      },
    });
    if (terminal) {
      const outcome = {
        schemaVersion: 1,
        deliberationId,
        projectId,
        policyId: policy.policyId,
        policyHash: deliberationPolicyHash(policy),
        status: "failed",
        lastRound: 1,
        artifactIds: [],
        lastConfirmedArtifactId: null,
        decisionArtifactId: null,
        passedVerificationArtifactIds: [],
        unresolvedBlockingObjectionIds: [],
        noConsensusReason: null,
        failure: {
          phase: "provider",
          code: "packed_fixture_failure",
          retryable: false,
        },
        completedAt,
      };
      storage.events.append({
        eventId: "evt_packed_deliberation_terminal_completed",
        projectId,
        runId: "run_packed_deliberation_root",
        sessionId: "ses_packed_deliberation_root",
        type: "deliberation.completed",
        occurredAt: completedAt,
        actor: { kind: "system" },
        schemaVersion: storage.writableEventSchemaVersion ?? 1,
        policyVersion: sha256("packed event policy"),
        payload: {
          deliberationId,
          outcomeId: calculateDeliberationOutcomeId(outcome),
          status: outcome.status,
          lastRound: outcome.lastRound,
          decisionArtifactId: outcome.decisionArtifactId,
          unresolvedBlockingObjectionIds: outcome.unresolvedBlockingObjectionIds,
          failurePhase: outcome.failure.phase,
          failureCode: outcome.failure.code,
        },
      });
    }
  } finally {
    await storage.close();
  }

  const dataDirectory = resolve(consumerRoot, ".lervo/data/conversation", integrationId);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const queue = await SQLiteConversationDeliberationJobStore.open({
    path: resolve(dataDirectory, "deliberations.sqlite"),
  });
  const origin = {
    conversationId: "cnv_packed_host_01",
    threadId: "thd_packed_host_01",
    requesterParticipantId: "ptc_packed_owner_01",
    originBindingDigest: calculateConversationDeliberationOriginBindingDigest({
      projectId,
      sourceEventId,
      conversationId: "cnv_packed_host_01",
      threadId: "thd_packed_host_01",
      requesterParticipantId: "ptc_packed_owner_01",
    }),
  };
  try {
    await queue.enqueue({
      projectId,
      sourceEventId,
      deliberationId,
      requestHash: sha256("packed deliberation request"),
      principalHash: sha256("packed deliberation principal"),
      origin,
      policyId: policy.policyId,
      topic: "Private packed host conformance topic.",
      requestedAt: occurredAt,
    });
    if (terminal) {
      const lease = await queue.claim({
        workerId: "packed-host-consumer",
        claimedAt: occurredAt,
        leaseDurationMs: 60_000,
      });
      assert.notEqual(lease, null);
      await queue.settle({
        deliberationId,
        leaseId: lease.leaseId,
        settledAt: completedAt,
        summary: {
          deliberationId,
          status: "failed",
          artifactCount: 0,
          nextAction: "none",
        },
      });
    }
  } finally {
    queue.close();
  }
  return { deliberationId, integrationId, sourceEventId, origin };
}

export async function verifyPackedProductHostSurfaces(runCli, consumerRoot, projectId) {
  const activity = parsed(await runCli(["application", "activity", "--limit", "100", "--json"]));
  assert.equal(activity.schemaVersion, 1);
  assert.equal(activity.kind, "product_surface.activity");
  assert.equal(activity.status, "complete");
  assert.equal(activity.items.length > 0, true);
  assert.equal(activity.items.length <= 100, true);
  assert.equal(JSON.stringify(activity).includes("payload"), false);

  const productSearch = parsed(
    await runCli([
      "application",
      "search",
      "--corpus",
      "repository_knowledge",
      "--limit",
      "5",
      "--json",
      "workstream",
    ]),
  );
  assert.equal(productSearch.schemaVersion, 1);
  assert.equal(productSearch.kind, "product_surface.search");
  assert.equal(["complete", "empty"].includes(productSearch.status), true);
  assert.equal(productSearch.searchPlan.engineId, "lexical");
  assert.equal(productSearch.searchPlan.engineVersion, 2);
  assert.deepEqual(productSearch.requestedCorpusClasses, ["repository_knowledge"]);
  assert.equal(JSON.stringify(productSearch).includes('"query":'), false);
  assert.equal(JSON.stringify(productSearch).includes("score"), false);

  const fixture = await prepareDeliberationFixture(consumerRoot, projectId, false);
  const deliberation = parsed(
    await runCli([
      "application",
      "deliberation",
      "--deliberation",
      fixture.deliberationId,
      "--integration",
      fixture.integrationId,
      "--json",
    ]),
  );
  assert.equal(deliberation.schemaVersion, 1);
  assert.equal(deliberation.kind, "product_surface.deliberation");
  assert.equal(deliberation.status, "running");
  assert.equal(deliberation.projectionStatus, "partial");
  assert.equal(deliberation.projectionReasonCode, "deliberation_resources_unavailable");
  assert.equal(deliberation.sourceEventId, fixture.sourceEventId);
  assert.equal(deliberation.conversationId, fixture.origin.conversationId);
  assert.equal(deliberation.threadId, fixture.origin.threadId);
  assert.equal(deliberation.requesterParticipantId, fixture.origin.requesterParticipantId);
  assert.equal(deliberation.originBindingDigest, fixture.origin.originBindingDigest);
  assert.equal(deliberation.participants.length, 5);
  assert.equal(
    deliberation.participants.every((participant) => participant.disposition === "policy_only"),
    true,
  );
  assert.deepEqual(deliberation.artifacts, []);
  assert.equal(deliberation.publicationCoordinate, null);
  assert.equal(deliberation.originDeliveryCoordinate, null);
  assert.equal(
    JSON.stringify(deliberation).includes("Private packed host conformance topic"),
    false,
  );
  assert.equal(JSON.stringify(deliberation).includes('"prompt"'), false);

  const terminalFixture = await prepareDeliberationFixture(consumerRoot, projectId, true);
  const terminalDeliberation = parsed(
    await runCli([
      "application",
      "deliberation",
      "--deliberation",
      terminalFixture.deliberationId,
      "--integration",
      terminalFixture.integrationId,
      "--json",
    ]),
  );
  assert.equal(terminalDeliberation.status, "failed");
  assert.equal(terminalDeliberation.nextAction, "none");
  assert.equal(terminalDeliberation.terminalReason, "packed_fixture_failure");
  assert.equal(terminalDeliberation.sourceEventId, terminalFixture.sourceEventId);
  assert.equal(terminalDeliberation.conversationId, terminalFixture.origin.conversationId);
  assert.equal(terminalDeliberation.threadId, terminalFixture.origin.threadId);
  assert.equal(
    terminalDeliberation.requesterParticipantId,
    terminalFixture.origin.requesterParticipantId,
  );
  assert.equal(
    terminalDeliberation.originBindingDigest,
    terminalFixture.origin.originBindingDigest,
  );
  assert.equal(terminalDeliberation.projectionStatus, "partial");
  assert.equal(terminalDeliberation.projectionReasonCode, "deliberation_resources_unavailable");
  assert.equal(terminalDeliberation.publicationCoordinate, null);
  assert.equal(terminalDeliberation.originDeliveryCoordinate, null);
  assert.equal(JSON.stringify(terminalDeliberation).includes("Private packed host"), false);
  assert.equal(JSON.stringify(terminalDeliberation).includes('"prompt"'), false);
}
