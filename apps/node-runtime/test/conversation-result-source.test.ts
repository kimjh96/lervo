import { createHash } from "node:crypto";

import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import { RepositoryConversationResultSource } from "../src/conversation-result-source.js";
import type { ConversationResultOrigin } from "../src/conversation-result-types.js";

const runId = "run_conversation_result_source";
const sessionId = "ses_conversation_result_source";
const content = "The managed result is verified.";
const bytes = new TextEncoder().encode(content);
const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const policyHash = `sha256:${"a".repeat(64)}`;

const origin: ConversationResultOrigin = {
  deliveryId: `rcd_${"1".repeat(64)}`,
  commandId: `rcm_${"2".repeat(64)}`,
  sourceEventId: `cve_${"3".repeat(64)}`,
  target: {
    integrationId: "itg_resultsource",
    projectId: "prj_resultsource",
    conversationId: "cnv_resultsource",
    threadId: null,
  },
  policyId: `cpp_${"4".repeat(64)}`,
  agentParticipantId: "ptc_resultsource",
  roleId: "developer",
  provider: "codex",
  workstreamId: `wks_${"5".repeat(24)}`,
  workstreamRevision: 3,
  workstreamSnapshotContentHash: `sha256:${"6".repeat(64)}`,
  assignmentId: `asn_${"7".repeat(24)}`,
  agentId: `agt_${"8".repeat(24)}`,
  queuedAt: "2026-09-07T08:00:00.000Z",
};

function event(
  seq: number,
  type: EventEnvelope["type"],
  payload: Record<string, unknown>,
  actor: EventEnvelope["actor"] = { kind: "system" },
  schemaVersion: 1 | 2 = 1,
): EventEnvelope {
  return {
    eventId: `evt_result_source_${seq}`,
    projectId: origin.target.projectId,
    runId,
    sessionId,
    seq,
    type,
    occurredAt: `2026-09-07T08:00:0${seq}.000Z`,
    actor,
    schemaVersion,
    policyVersion: policyHash,
    payload,
    previousHash: seq === 1 ? null : policyHash,
    eventHash: policyHash,
  } as EventEnvelope;
}

function events(assignmentId = origin.assignmentId): EventEnvelope[] {
  return [
    event(
      1,
      "work.causality.recorded",
      {
        workId: `wrk_${"9".repeat(24)}`,
        executionContractVersion: 1,
        relationship: "root",
        parentRunId: null,
        retryOfRunId: null,
        attemptOrdinal: 1,
        workstreamId: origin.workstreamId,
        assignmentId,
        agentId: origin.agentId,
      },
      { kind: "system" },
      2,
    ),
    event(2, "run.requested", { requestDigest: policyHash, role: origin.roleId, risk: "medium" }),
    event(
      3,
      "adapter.result.captured",
      {
        adapterId: "codex-result-source",
        providerSessionId: "provider-session-result-source",
        targetTurnId: "turn-result-source",
        providerTurnId: "provider-turn-result-source",
        resultDigest: contentHash,
        byteCount: bytes.byteLength,
        mediaType: "text/markdown; charset=utf-8",
        referenceTelemetry: "supported",
      },
      { kind: "agent", provider: origin.provider },
    ),
    event(4, "run.completed", {
      resultDigest: contentHash,
      artifactIds: [`art_${contentHash.slice("sha256:".length)}`],
      verificationStatus: "passed",
    }),
  ];
}

function storage(runEvents: EventEnvelope[]) {
  const close = vi.fn(async () => undefined);
  const value = {
    events: {
      list: ({ afterSeq = 0, limit = 100 }: { afterSeq?: number; limit?: number }) =>
        runEvents.filter((item) => item.seq > afterSeq).slice(0, limit),
    },
    artifacts: {
      get: vi.fn(async () => bytes),
    },
    close,
  } as unknown as ProjectStorage;
  return { value, close };
}

describe("repository conversation result source", () => {
  it("returns only a passed artifact bound to the exact conversation causality", async () => {
    const fixture = storage(events());
    const source = new RepositoryConversationResultSource("/repository", async () => fixture.value);

    await expect(source.read({ origin, runId })).resolves.toEqual({ runId, content });
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("rejects assignment drift and still closes project storage", async () => {
    const fixture = storage(events(`asn_${"f".repeat(24)}`));
    const source = new RepositoryConversationResultSource("/repository", async () => fixture.value);

    await expect(source.read({ origin, runId })).rejects.toThrow(/differs/u);
    expect(fixture.close).toHaveBeenCalledOnce();
  });
});
