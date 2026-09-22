import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { afterEach, expect, it, vi } from "vitest";

import { DiscordSupervisionWorkResponder } from "../src/discord-supervision-work-responder.js";
import { SupervisionRequestRefusedError } from "../src/supervision-request-refusal.js";
import type { NodeSupervisionStartupConfiguration } from "../src/supervision-startup-config.js";
import type { admitSupervisionRequest } from "../src/supervision-request-intake.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(actor: {
  kind: "human" | "agent";
  participantId: string;
  roleId: string | null;
}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-discord-supervision-"));
  roots.push(root);
  const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
  const content = await artifacts.put("Complete the current goal.");
  const event = createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey("discord-supervision-1"),
    target: {
      integrationId: "itg_supervisiontest",
      projectId: `prj_${"a".repeat(16)}`,
      conversationId: "cnv_supervisiontest",
      threadId: null,
    },
    kind: "message.created",
    actor,
    content: {
      artifactId: `art_${content.contentHash.slice(7)}`,
      contentHash: content.contentHash,
      byteCount: content.byteCount,
      mediaType: "text/plain; charset=utf-8",
    },
    mentions: { participantIds: [], roleIds: [] },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 0,
    occurredAt: "2026-09-13T00:00:00.000Z",
  });
  const configuration = {
    binding: {
      supervisionId: "supervision.fixture",
      workstreamId: `wks_${"b".repeat(24)}`,
      ownerAgentId: `agt_${"c".repeat(24)}`,
      mandateHash: `sha256:${"d".repeat(64)}`,
    },
  } as NodeSupervisionStartupConfiguration;
  const admitRequest = vi.fn(async (_input: Parameters<typeof admitSupervisionRequest>[0]) => ({
    eventId: `evt_${"e".repeat(32)}`,
    duplicate: false,
  }));
  const managedReply = { content: { contentHash: `sha256:${"3".repeat(64)}` } } as never;
  const resultResponder = {
    respond: vi.fn(async () => managedReply),
  };
  const responder = new DiscordSupervisionWorkResponder({
    repositoryRoot: root,
    projectId: event.target.projectId,
    artifactStore: artifacts,
    resultResponder,
    configuration,
    policyId: `cpp_${"f".repeat(64)}`,
    speaker: { participantId: "ptc_supervisionowner", roleId: "developer" },
    authorizedEffectRequesters: [
      {
        participantId: "ptc_central01",
        roleId: "manager",
        conversationId: event.target.conversationId,
      },
    ],
    admitRequest,
  });
  return { event, responder, admitRequest, managedReply, resultResponder };
}

it("preserves the authenticated requester and exact reply origin at shared intake", async () => {
  const f = await fixture({ kind: "agent", participantId: "ptc_central01", roleId: "manager" });
  const admittedReply = { content: { contentHash: `sha256:${"1".repeat(64)}` } } as never;
  await expect(f.responder.respond({ event: f.event } as never, admittedReply)).resolves.toBe(
    admittedReply,
  );
  expect(f.admitRequest).toHaveBeenCalledOnce();
  expect(f.admitRequest.mock.calls[0]![0]).toMatchObject({
    admissionDeadlineMs: 120_000,
    request: {
      source: "discord",
      sourceId: f.event.eventId,
      requesterId: "ptc_central01:manager",
      request: "Complete the current goal.",
      origin: {
        sourceEventId: f.event.eventId,
        target: f.event.target,
        actor: { kind: "agent", participantId: "ptc_supervisionowner", roleId: "developer" },
      },
    },
  });
});

it("does not replace a natural-language admission with a fixed status message", async () => {
  const f = await fixture({ kind: "human", participantId: "ptc_human0001", roleId: null });
  const admittedReply = { content: { contentHash: `sha256:${"2".repeat(64)}` } } as never;
  await expect(f.responder.respond({ event: f.event } as never, admittedReply)).resolves.toBe(
    admittedReply,
  );
});

it("rejects a natural-language admission when its managed acknowledgment is missing", async () => {
  const f = await fixture({ kind: "human", participantId: "ptc_human0001", roleId: null });
  await expect(f.responder.respond({ event: f.event } as never)).rejects.toThrow(
    /requires its managed reply/iu,
  );
});

it("rejects an unadmitted agent before reading or binding its request", async () => {
  const f = await fixture({ kind: "agent", participantId: "ptc_other0001", roleId: "manager" });
  await expect(f.responder.respond({ event: f.event } as never)).rejects.toThrow(
    /not authorized/iu,
  );
  expect(f.admitRequest).not.toHaveBeenCalled();
});

it("answers a refused binding with its bounded reason", async () => {
  const f = await fixture({ kind: "human", participantId: "ptc_human0001", roleId: null });
  f.admitRequest.mockRejectedValueOnce(
    new SupervisionRequestRefusedError(
      "origin_conflict",
      "The workstream already has a supervised request origin.",
    ),
  );
  const reply = await f.responder.respond({ event: f.event } as never);
  expect(reply).toBe(f.managedReply);
  expect(f.resultResponder.respond).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.objectContaining({
        completedEffect: {
          effectId: "supervision_goal_request",
          resultCode: "origin_conflict",
          targetLabel: "the requested durable goal",
          facts: [
            "The current supervised workstream is already bound to a different source request.",
            "This request was not bound and no work started from it.",
          ],
        },
      }),
    }),
  );
});

it("writes duplicate intake state through the managed conversation responder", async () => {
  const f = await fixture({ kind: "human", participantId: "ptc_human0001", roleId: null });
  f.admitRequest.mockResolvedValueOnce({ eventId: `evt_${"e".repeat(32)}`, duplicate: true });
  await expect(f.responder.respond({ event: f.event } as never)).resolves.toBe(f.managedReply);
  expect(f.resultResponder.respond).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.objectContaining({
        completedEffect: expect.objectContaining({ resultCode: "already_bound" }),
      }),
    }),
  );
});

it("marks an unclassified intake failure as an idempotently retryable uncertain admission", async () => {
  const f = await fixture({ kind: "human", participantId: "ptc_human0001", roleId: null });
  f.admitRequest.mockRejectedValueOnce(new Error("sqlite closed"));
  await expect(f.responder.respond({ event: f.event } as never)).rejects.toMatchObject({
    name: "SupervisionAdmissionUnconfirmedError",
    code: "supervision_admission_unconfirmed",
  });
});
