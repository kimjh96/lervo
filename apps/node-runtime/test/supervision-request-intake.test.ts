import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  createConversationInboundEvent,
  createConversationParticipationDecision,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteConversationInteractionStore } from "@lervo/interaction-sqlite";
import { openProjectStorage } from "@lervo/project-storage";
import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
} from "../../cli/src/mandate-installation.js";

import { admitSupervisionRequest } from "../src/supervision-request-intake.js";
import { NodeSupervisionStore } from "../src/supervision-store.js";
import { readBoundSupervisionRequest } from "../src/supervision-bound-request.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { SQLiteConversationHistory } from "../src/conversation-history.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

it("binds a local request to one installed owner and replays its exact source without a new event", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const request = {
    source: "local" as const,
    sourceId: "request-1",
    requesterId: "local_process_owner",
    request: "Complete the current bounded goal.",
    contentHash: hash("Complete the current bounded goal."),
  };
  const first = await admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request,
  });
  expect(first.duplicate).toBe(false);
  const replay = await admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request,
  });
  expect(replay).toEqual({ ...first, duplicate: true });
  const storage = await openProjectStorage(f.root);
  try {
    const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
    expect(
      source.supervisionEvents.filter((event) => event.type === "work.supervision.bound"),
    ).toHaveLength(1);
    expect(await readBoundSupervisionRequest(storage, source, f.binding)).toMatchObject({
      eventId: first.eventId,
      request: request.request,
      origin: null,
    });
    const owner = await canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now);
    expect(owner.facts.boundRequest?.request).toBe(request.request);
    expect(source.assignments).toHaveLength(0);
  } finally {
    await storage.close();
  }
  await expect(
    admitSupervisionRequest({
      repositoryRoot: f.root,
      binding: f.binding,
      request: {
        ...request,
        request: "A conflicting goal.",
        contentHash: hash("A conflicting goal."),
      },
    }),
  ).rejects.toMatchObject({ name: "SupervisionRequestRefusedError", code: "identity_conflict" });
  await expect(
    admitSupervisionRequest({
      repositoryRoot: f.root,
      binding: f.binding,
      request: { ...request, sourceId: "request-2" },
    }),
  ).rejects.toMatchObject({
    name: "SupervisionRequestRefusedError",
    code: "origin_conflict",
    message: expect.stringMatching(/already has a supervised request origin/iu),
  });
  await expect(
    admitSupervisionRequest({
      repositoryRoot: f.root,
      binding: f.binding,
      request: { ...request, sourceId: "request-3", contentHash: hash("Different bytes") },
    }),
  ).rejects.toMatchObject({ name: "SupervisionRequestRefusedError", code: "request_invalid" });
  const store = await NodeSupervisionStore.open({ repositoryRoot: f.root, binding: f.binding });
  try {
    let releaseOwner!: () => void;
    const held = store.withOwner(
      () => new Promise<void>((resolveHold) => (releaseOwner = resolveHold)),
    );
    await new Promise<void>((resolveTick) => setTimeout(resolveTick, 50));
    await expect(
      admitSupervisionRequest({
        repositoryRoot: f.root,
        binding: f.binding,
        request: { ...request, sourceId: "request-4" },
        admissionDeadlineMs: 300,
      }),
    ).rejects.toMatchObject({ name: "SupervisionRequestRefusedError", code: "owner_busy" });
    releaseOwner();
    await held;
  } finally {
    await store.close();
  }
  await expect(
    admitSupervisionRequest({
      repositoryRoot: f.root,
      binding: f.binding,
      request,
      admissionDeadlineMs: 600_001,
    }),
  ).rejects.toMatchObject({ name: "SupervisionRequestRefusedError", code: "request_invalid" });
});

it("wakes request admission when the installed owner lease is released", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const store = await NodeSupervisionStore.open({ repositoryRoot: f.root, binding: f.binding });
  let releaseOwner!: () => void;
  const held = store.withOwner(
    () => new Promise<void>((resolveHold) => (releaseOwner = resolveHold)),
  );
  await new Promise<void>((resolveTick) => setTimeout(resolveTick, 50));
  const admission = admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request: {
      source: "local",
      sourceId: "lease-release-request",
      requesterId: "local_process_owner",
      request: "Start after the current owner cycle releases its lease.",
      contentHash: hash("Start after the current owner cycle releases its lease."),
    },
    admissionDeadlineMs: 3_000,
  });
  await new Promise<void>((resolveTick) => setTimeout(resolveTick, 400));
  releaseOwner();
  await held;
  try {
    await expect(admission).resolves.toMatchObject({ duplicate: false });
  } finally {
    await store.close();
  }
});

it("retains the exact Discord result origin within the same canonical request contract", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const target = {
    integrationId: "itg_supervisiontest",
    projectId: f.owner.projectId,
    conversationId: "cnv_supervisiontest",
    threadId: null,
  };
  const requestText = "Complete the current bounded goal.";
  const ingress = createConversationInboundEvent({
    kind: "message.created",
    actor: { kind: "human", participantId: "ptc_requester01", roleId: null },
    target,
    content: {
      artifactId: `art_${hash(requestText).slice(7)}`,
      contentHash: hash(requestText),
      byteCount: Buffer.byteLength(requestText),
      mediaType: "text/plain; charset=utf-8",
    },
    sourceEventKeyHash: hashConversationSourceEventKey("discord-test-command"),
    occurredAt: "2026-09-14T05:37:09.720Z",
    replyToEventId: null,
    signalCode: null,
    mentions: { participantIds: [], roleIds: [] },
    automationDepth: 0,
  });
  const origin = {
    sourceEventId: ingress.eventId,
    policyId: `cpp_${"4".repeat(64)}`,
    target,
    actor: {
      kind: "agent" as const,
      participantId: "ptc_supervisionowner",
      roleId: f.owner.roleId,
    },
  };
  const admitted = await admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request: {
      source: "discord",
      sourceId: origin.sourceEventId,
      requesterId: "ptc_requester01:human",
      request: requestText,
      contentHash: hash(requestText),
      origin,
    },
  });
  const storage = await openProjectStorage(f.root);
  try {
    const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
    expect(await readBoundSupervisionRequest(storage, source, f.binding)).toMatchObject({
      eventId: admitted.eventId,
      source: "discord",
      origin,
    });
    expect(
      (await canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now)).facts
        .requesterProvenance,
    ).toBeNull();
    const directory = resolve(storage.paths.data, "conversation", target.integrationId);
    await mkdir(directory, { recursive: true });
    const database = new DatabaseSync(resolve(directory, "interactions.sqlite"));
    try {
      database.exec(
        "CREATE TABLE conversation_inbox (event_id TEXT, role_id TEXT, event_json TEXT, policy_id TEXT, integration_id TEXT, project_id TEXT, conversation_id TEXT, status TEXT)",
      );
      database
        .prepare("INSERT INTO conversation_inbox VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          ingress.eventId,
          f.owner.roleId,
          JSON.stringify(ingress),
          origin.policyId,
          target.integrationId,
          target.projectId,
          target.conversationId,
          "completed",
        );
      expect(
        (await canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now)).facts
          .requesterProvenance,
      ).toBeNull();
      const intentDatabase = new DatabaseSync(resolve(directory, "intent-resolutions.sqlite"));
      try {
        intentDatabase.exec(
          "CREATE TABLE conversation_intent_resolutions (event_id TEXT PRIMARY KEY, message_hash TEXT, intent TEXT, confidence TEXT, participation TEXT, effect_json TEXT)",
        );
        intentDatabase
          .prepare("INSERT INTO conversation_intent_resolutions VALUES (?, ?, ?, ?, ?, ?)")
          .run(
            ingress.eventId,
            ingress.content.contentHash,
            "continue_work",
            "high",
            "relevant",
            JSON.stringify({ kind: "supervision_goal_request" }),
          );
      } finally {
        intentDatabase.close();
      }
      expect(
        (await canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now)).facts
          .requesterProvenance,
      ).toEqual({
        status: "verified",
        ingressKind: "message.created",
        requesterKind: "human",
        sourceEventId: ingress.eventId,
        sourceEventKeyHash: ingress.sourceEventKeyHash,
        contentHash: hash(requestText),
      });
      database.prepare("UPDATE conversation_inbox SET event_json = ? WHERE event_id = ?").run(
        JSON.stringify({
          ...ingress,
          actor: { kind: "agent", participantId: "ptc_requester01", roleId: f.owner.roleId },
        }),
        ingress.eventId,
      );
      await expect(
        canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now),
      ).rejects.toThrow(/Discord ingress evidence is invalid/u);
    } finally {
      database.close();
    }
  } finally {
    await storage.close();
  }
});

it("binds prior conversation evidence with a Discord goal and verifies it after reopening", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const target = {
    integrationId: "itg_supervisionctx1",
    projectId: f.owner.projectId,
    conversationId: "cnv_supervisionctx1",
    threadId: null,
  };
  const directory = resolve(f.root, ".lervo", "data", "conversation", target.integrationId);
  await mkdir(directory, { recursive: true });
  const artifacts = await FileSystemCas.open(resolve(directory, "artifacts"));
  const policy = createConversationParticipationPolicy({
    projectId: target.projectId,
    roleId: f.owner.roleId,
    conversationIds: [target.conversationId],
    mode: "relevant",
    respondTo: ["human"],
    signalCodes: [],
    cooldownSeconds: 0,
    maxResponsesPerHour: 20,
    maxAutomationDepth: 2,
    createdAt: "2026-09-14T00:00:00.000Z",
  });
  const priorText = "The fourth task is to repair backup capacity without deleting state.";
  const requestText = "Do those four tasks through deployment.";
  const priorContent = await artifacts.put(priorText);
  const requestContent = await artifacts.put(requestText);
  const makeEvent = (
    text: string,
    content: typeof priorContent,
    kind: "message.created" | "goal.requested",
    occurredAt: string,
  ) =>
    createConversationInboundEvent({
      kind,
      actor: { kind: "human", participantId: "ptc_requester01", roleId: null },
      target,
      content: {
        artifactId: `art_${content.contentHash.slice(7)}`,
        contentHash: content.contentHash,
        byteCount: content.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      sourceEventKeyHash: hashConversationSourceEventKey(text),
      occurredAt,
      replyToEventId: null,
      signalCode: null,
      mentions:
        kind === "goal.requested"
          ? { participantIds: ["ptc_supervisionowner"], roleIds: [f.owner.roleId] }
          : { participantIds: [], roleIds: [] },
      automationDepth: 0,
    });
  const prior = makeEvent(priorText, priorContent, "message.created", "2026-09-14T00:00:01.000Z");
  const ingress = makeEvent(
    requestText,
    requestContent,
    "goal.requested",
    "2026-09-14T00:00:03.000Z",
  );
  const path = resolve(directory, "interactions.sqlite");
  const interactions = await SQLiteConversationInteractionStore.open({ path });
  try {
    const claim = await interactions.claimInbound({
      event: prior,
      policy,
      workerId: "context-fixture",
      claimedAt: "2026-09-14T00:00:01.000Z",
      leaseDurationMs: 60_000,
    });
    if (claim.status !== "claimed") throw new Error("Prior context fixture was not claimed.");
    await interactions.completeInbound({
      eventId: prior.eventId,
      policyId: policy.policyId,
      roleId: policy.roleId,
      leaseId: claim.leaseId,
      decision: createConversationParticipationDecision({
        event: prior,
        policy,
        action: "observe",
        reason: "turn_not_owned",
        relevance: "not_checked",
        decidedAt: "2026-09-14T00:00:02.000Z",
      }),
      outbound: null,
    });
    const ingressClaim = await interactions.claimInbound({
      event: ingress,
      policy,
      workerId: "context-fixture",
      claimedAt: "2026-09-14T00:00:03.000Z",
      leaseDurationMs: 60_000,
    });
    if (ingressClaim.status !== "claimed") throw new Error("Goal fixture was not claimed.");
  } finally {
    await interactions.close();
  }
  const context = await new SQLiteConversationHistory(path, artifacts).recentEvidence(ingress);
  expect(context.map((turn) => turn.text)).toEqual([priorText]);
  const origin = {
    sourceEventId: ingress.eventId,
    policyId: policy.policyId,
    target,
    actor: {
      kind: "agent" as const,
      participantId: "ptc_supervisionowner",
      roleId: f.owner.roleId,
    },
  };
  const request = {
    source: "discord" as const,
    sourceId: ingress.eventId,
    requesterId: "ptc_requester01:human",
    request: requestText,
    contentHash: requestContent.contentHash,
    origin,
    conversationContext: context,
  };
  const admission = await admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request,
  });
  const storage = await openProjectStorage(f.root);
  try {
    const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
    expect(
      (await readBoundSupervisionRequest(storage, source, f.binding))?.conversationContext,
    ).toEqual(context);
    const facts = (await canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now))
      .facts;
    expect(facts.requesterProvenance?.status).toBe("verified");
    expect(facts.boundRequest?.conversationContext?.[0]?.text).toBe(priorText);
  } finally {
    await storage.close();
  }
  await expect(
    admitSupervisionRequest({
      repositoryRoot: f.root,
      binding: f.binding,
      request: { ...request, conversationContext: [] },
    }),
  ).resolves.toEqual({ eventId: admission.eventId, duplicate: true });
});

it("retains the original request through approved mandate successors", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const request = "Complete the existing bounded goal.";
  const admitted = await admitSupervisionRequest({
    repositoryRoot: f.root,
    binding: f.binding,
    request: {
      source: "local",
      sourceId: "successor-request",
      requesterId: "local_process_owner",
      request,
      contentHash: hash(request),
    },
  });
  let binding = f.binding;
  for (const version of [2, 3]) {
    const plan = await createRepositoryMandatePlan({
      root: f.root,
      mandate: {
        ...f.mandate,
        version,
        maximumAggregateTokens: f.mandate.maximumAggregateTokens + version * 100,
      },
      supervisionId: binding.supervisionId,
      reviewerId: f.mandate.appointingAuthorityId,
    });
    const installed = await installRepositoryMandate({
      root: f.root,
      plan,
      approval: plan.approvalHash,
      reviewerId: f.mandate.appointingAuthorityId,
    });
    binding = { ...binding, mandateHash: installed.mandateHash };
  }
  const storage = await openProjectStorage(f.root);
  try {
    const source = await new SupervisionTaskSource(storage, binding, f.ports.now).read();
    expect(await readBoundSupervisionRequest(storage, source, binding)).toMatchObject({
      eventId: admitted.eventId,
      request,
      origin: null,
    });
    expect(
      source.supervisionEvents.filter((event) => event.type === "work.supervision.bound"),
    ).toHaveLength(1);
    await expect(
      readBoundSupervisionRequest(storage, source, {
        ...binding,
        mandateHash: hash("unrelated mandate"),
      }),
    ).rejects.toThrow("supervision_binding_invalid");
  } finally {
    await storage.close();
  }
  expect(
    await admitSupervisionRequest({
      repositoryRoot: f.root,
      binding,
      request: {
        source: "local",
        sourceId: "successor-request",
        requesterId: "local_process_owner",
        request,
        contentHash: hash(request),
      },
    }),
  ).toEqual({ eventId: admitted.eventId, duplicate: true });
});
