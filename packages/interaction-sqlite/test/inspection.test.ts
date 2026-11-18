import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createConversationParticipationPolicy } from "@lervo/conversation-contract";
import { handleConversationEvent, runConversationDeliveryCycle } from "@lervo/interaction";
import type { WritingPublicationPermit } from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectConversationOutboundDeliveries,
  SQLiteConversationInteractionStore,
} from "../src/index.js";
import { TestConversationAdapter } from "../../conversation-contract/test/conversation-adapter.fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation outbound delivery inspection", () => {
  it("joins the normalized source, writing-gated outbound, and delivery receipt read-only", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-interaction-inspection-"));
    roots.push(root);
    const path = resolve(root, "interactions.sqlite");
    const adapter = new TestConversationAdapter({
      integrationId: "itg_inspection01",
      instanceIdentity: "inspection-instance",
      delivery: {
        send: async () => ({
          deliveryKey: "native-delivery-key",
          deliveredAt: "2026-09-17T00:00:03.000Z",
        }),
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "inspection-source",
      target: {
        projectId: "prj_inspection01",
        conversationId: "cnv_inspection01",
        threadId: null,
      },
      kind: "signal.raised",
      actor: { kind: "system", participantId: "ptc_lervo_system", roleId: null },
      content: {
        artifactId: "art_inspection_source",
        contentHash: `sha256:${"a".repeat(64)}`,
        byteCount: 12,
        mediaType: "text/plain; charset=utf-8",
      },
      signalCode: "deliberation.completed",
      occurredAt: "2026-09-17T00:00:00.000Z",
    });
    const policy = createConversationParticipationPolicy({
      projectId: "prj_inspection01",
      roleId: "role_inspection_agent",
      conversationIds: ["cnv_inspection01"],
      mode: "proactive",
      respondTo: ["system"],
      signalCodes: ["deliberation.completed"],
      cooldownSeconds: 0,
      maxResponsesPerHour: 5,
      maxAutomationDepth: 2,
      createdAt: "2026-09-17T00:00:00.000Z",
    });
    const content = {
      artifactId: "art_inspection_result",
      contentHash: `sha256:${"b".repeat(64)}`,
      byteCount: 18,
      mediaType: "text/plain; charset=utf-8" as const,
    };
    const permitInput: Omit<WritingPublicationPermit, "permitId"> = {
      schemaVersion: 1,
      surface: "chat",
      artifactId: content.artifactId,
      contentHash: content.contentHash,
      writingPolicyId: "writing_en-human",
      writingPolicyHash: `sha256:${"c".repeat(64)}`,
      evaluationId: "wre_inspection01",
      evaluationHash: `sha256:${"d".repeat(64)}`,
      issuedAt: "2026-09-17T00:00:01.000Z",
    };
    const publicationPermit = {
      ...permitInput,
      permitId: calculateWritingPublicationPermitId(permitInput),
    };
    const store = await SQLiteConversationInteractionStore.open({ path });
    const handled = await handleConversationEvent({
      event,
      policy,
      workerId: "inspection-worker",
      agentParticipantId: "ptc_inspection_agent",
      store,
      responder: {
        respond: async () => ({
          content,
          publicationPermit,
          publicationEvidence: {
            artifact: {
              ...content,
              uri: `lervo-cas://sha256/${"b".repeat(64)}`,
              mediaType: "text/markdown; charset=utf-8",
            },
            evaluation: {
              schemaVersion: 1,
              evaluationId: "wre_inspection01",
              writingPolicyId: "writing_en-human",
              artifactId: content.artifactId,
              contentHash: content.contentHash,
              locale: "en",
              checkedAt: "2026-09-17T00:00:01.000Z",
              evaluators: [{ kind: "deterministic", evaluatorId: "inspection" }],
              checks: [
                {
                  checkId: "inspection",
                  kind: "deterministic",
                  status: "passed",
                  violationCount: 0,
                  evidenceDigest: null,
                },
              ],
              overallStatus: "passed",
            },
            evaluationArtifact: {
              artifactId: "art_inspection_evaluation",
              uri: `lervo-cas://sha256/${"d".repeat(64)}`,
              mediaType: "application/vnd.lervo.writing-evaluation+json; charset=utf-8",
              contentHash: `sha256:${"d".repeat(64)}`,
              byteCount: 10,
            },
          },
        }),
      },
      publicationVerifier: { verify: async () => undefined },
      clock: () => new Date("2026-09-17T00:00:01.000Z"),
    });
    expect(handled.status).toBe("completed");
    await runConversationDeliveryCycle({
      adapter,
      store,
      workerId: "inspection-delivery",
      clock: () => new Date("2026-09-17T00:00:02.000Z"),
    });
    await store.close();

    const records = await inspectConversationOutboundDeliveries({
      path,
      sourceEventId: event.eventId,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      status: "delivered",
      outbound: {
        sourceEventId: event.eventId,
        publicationPermit: { permitId: publicationPermit.permitId },
      },
      receipt: { deliveredAt: "2026-09-17T00:00:03.000Z" },
    });
  });
});
