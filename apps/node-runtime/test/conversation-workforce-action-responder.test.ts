import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { describe, expect, it, vi } from "vitest";

import { ConversationWorkforceActionResponder } from "../src/conversation-workforce-action-responder.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

function hiredAgent() {
  return {
    schemaVersion: 1 as const,
    agentId: "agt_0123456789abcdef01234567",
    projectId: "prj_test0001",
    displayName: "Navi",
    displayNameSource: "explicit" as const,
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    roleProfileHash: `sha256:${"b".repeat(64)}`,
    provider: "any" as const,
    capabilityHash: `sha256:${"c".repeat(64)}`,
    skillIds: [],
    capabilityPackages: [],
    responsibilityPaths: ["*"],
    parentAgentId: "agt_abcdef0123456789abcdef01",
    delegationDepth: 1,
    status: "active" as const,
    revision: 1,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
}

describe("conversation workforce action responder", () => {
  it.each([false, true])(
    "preserves hiring ownership with separate deployment=%s",
    async (separateDeployment) => {
      const root = await temporaryRoot();
      const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
      const source = await artifactStore.put("필요한 개발자를 알아서 고용하세요.");
      const event = createConversationInboundEvent({
        sourceEventKeyHash: hashConversationSourceEventKey("discord-hire-1"),
        target: {
          integrationId: "itg_discord01",
          projectId: "prj_test0001",
          conversationId: "cnv_test0001",
          threadId: null,
        },
        kind: "message.created",
        actor: { kind: "human", participantId: "ptc_owner0001", roleId: null },
        mentions: { participantIds: [], roleIds: [] },
        content: {
          artifactId: `art_${source.contentHash.slice(7)}`,
          contentHash: source.contentHash,
          byteCount: source.byteCount,
          mediaType: "text/plain; charset=utf-8",
        },
        replyToEventId: null,
        signalCode: null,
        automationDepth: 0,
        occurredAt: "2026-09-10T00:00:00.000Z",
      });
      const hiring = { hire: vi.fn(async () => hiredAgent()) };
      const deployment = {
        prepare: vi.fn(async () => ({
          participantId: "ptc_agent_0123456789abcdef01234567",
          webhookId: "623456789012345678",
          configurationChanged: true,
        })),
      };
      const onDeploymentPrepared = vi.fn();
      const onConversationDelegateHired = vi.fn();
      const responder = new ConversationWorkforceActionResponder({
        artifactStore,
        parentAgentId: "agt_abcdef0123456789abcdef01",
        parentRoleId: "product-owner",
        hiring,
        ...(separateDeployment ? { deployment } : {}),
        onConversationDelegateHired,
        onDeploymentPrepared,
      });

      const reply = await responder.respond(
        { event } as Parameters<ConversationWorkforceActionResponder["respond"]>[0],
        {
          kind: "workforce_agent_hire",
          specification: JSON.stringify({ name: "Navi", roleId: "developer", provider: "any" }),
        },
        { effectRequesterAuthorized: true },
      );

      expect(hiring.hire).toHaveBeenCalledWith({
        name: "Navi",
        roleId: "developer",
        provider: "any",
        parentAgentId: "agt_abcdef0123456789abcdef01",
      });
      if (separateDeployment) {
        expect(deployment.prepare).toHaveBeenCalledWith({
          agent: hiredAgent(),
          conversationId: "cnv_test0001",
        });
        expect(onDeploymentPrepared).toHaveBeenCalledWith(event.eventId);
        expect(onConversationDelegateHired).not.toHaveBeenCalled();
      } else {
        expect(onConversationDelegateHired).toHaveBeenCalledWith(
          expect.objectContaining({
            agent: hiredAgent(),
            conversationId: "cnv_test0001",
            threadId: null,
          }),
        );
        expect(onDeploymentPrepared).not.toHaveBeenCalled();
      }
      const bytes = await artifactStore.get(
        `lervo-cas://sha256/${reply.content.contentHash.slice(7)}`,
      );
      expect(new TextDecoder().decode(bytes)).toContain("Navi");
      expect(new TextDecoder().decode(bytes)).toContain(
        separateDeployment ? "별도 Discord 발화자와 독립 작업 맥락" : "활성 실행 담당자",
      );
      await removeTemporaryRoots();
    },
  );

  it("rejects unadmitted requesters and malformed specifications before hiring", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const hiring = { hire: vi.fn(async () => hiredAgent()) };
    const responder = new ConversationWorkforceActionResponder({
      artifactStore,
      parentAgentId: "agt_abcdef0123456789abcdef01",
      parentRoleId: "product-owner",
      hiring,
    });
    const request = { event: { target: { conversationId: "cnv_test0001" } } } as never;

    await expect(
      responder.respond(
        request,
        {
          kind: "workforce_agent_hire",
          specification: '{"name":"Navi","provider":"any","roleId":"developer"}',
        },
        { effectRequesterAuthorized: false },
      ),
    ).rejects.toThrow("not authorized");
    expect(hiring.hire).not.toHaveBeenCalled();
    await removeTemporaryRoots();
  });
});
