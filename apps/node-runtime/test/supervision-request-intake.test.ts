import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
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
    kind: "goal.requested",
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
    mentions: { participantIds: ["ptc_supervisionowner"], roleIds: [f.owner.roleId] },
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
      ).toEqual({
        status: "verified",
        ingressKind: "goal.requested",
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
