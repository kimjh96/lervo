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
  const responder = new DiscordSupervisionWorkResponder({
    repositoryRoot: root,
    projectId: event.target.projectId,
    artifactStore: artifacts,
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
  return { event, responder, admitRequest };
}

it("preserves the authenticated requester and exact reply origin at shared intake", async () => {
  const f = await fixture({ kind: "agent", participantId: "ptc_central01", roleId: "manager" });
  await f.responder.respond({ event: f.event } as never);
  expect(f.admitRequest).toHaveBeenCalledOnce();
  expect(f.admitRequest.mock.calls[0]![0]).toMatchObject({
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

it("rejects an unadmitted agent before reading or binding its request", async () => {
  const f = await fixture({ kind: "agent", participantId: "ptc_other0001", roleId: "manager" });
  await expect(f.responder.respond({ event: f.event } as never)).rejects.toThrow(
    /not authorized/iu,
  );
  expect(f.admitRequest).not.toHaveBeenCalled();
});
