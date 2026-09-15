import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { recordVerifiedConversationWorkMemory } from "../src/conversation-agent-memory.js";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function completion(summary: string) {
  return {
    eventId: "evt_repositorywork01",
    eventHash: hash("completion-event"),
    projectId: "prj_context0001",
    runId: "run_repositorywork01",
    sessionId: "ses_repositorywork01",
    seq: 12,
    type: "conversation.repository_work.completed",
    occurredAt: "2026-09-16T00:00:00.000Z",
    actor: { kind: "agent", provider: "codex" },
    schemaVersion: 2,
    policyVersion: hash("policy"),
    payload: {
      workerAgentId: `agt_${"a".repeat(24)}`,
      resultContentHash: hash(summary),
      verificationStatus: "passed",
    },
  } as const;
}

describe("verified conversation work memory", () => {
  it("records bounded private retrieval coordinates without leaking summary terms", async () => {
    const summary = "Improved repository memory selection.";
    const append = vi.fn();
    const storage = {
      manifest: { projectId: "prj_context0001" },
      artifacts: {
        put: vi.fn(async (value: string) => ({
          uri: `lervo-cas://sha256/${hash(value).slice(7)}`,
          contentHash: hash(value),
          byteCount: Buffer.byteLength(value),
          created: true,
        })),
      },
      events: { append },
    };

    await recordVerifiedConversationWorkMemory({
      projectId: "prj_context0001",
      events: storage.events as never,
      artifacts: storage.artifacts as never,
      completion: completion(summary) as never,
      summary,
      workerAgentId: `agt_${"a".repeat(24)}`,
      changedPaths: ["apps/node-runtime/src/agent-context-document.ts"],
    });

    expect(append).toHaveBeenCalledOnce();
    const draft = append.mock.calls[0]![0];
    expect(draft).toMatchObject({
      type: "agent.context.promoted",
      payload: {
        memoryKind: "work_outcome",
        audience: "agent",
        sensitivity: "internal",
        confidence: "medium",
        reviewEventId: "evt_repositorywork01",
      },
    });
    expect(JSON.stringify(draft.payload.retrievalDigests)).not.toContain("repository");
    expect(draft.payload.retrievalDigests).toHaveLength(5);
  });

  it("rejects a completion recorded for another agent", async () => {
    const summary = "Reviewed work.";
    await expect(
      recordVerifiedConversationWorkMemory({
        projectId: "prj_context0001",
        artifacts: {
          put: async () => ({
            uri: `lervo-cas://sha256/${hash(summary).slice(7)}`,
            contentHash: hash(summary),
            byteCount: Buffer.byteLength(summary),
            created: true,
          }),
        } as never,
        events: { append: vi.fn() } as never,
        completion: completion(summary) as never,
        summary,
        workerAgentId: `agt_${"b".repeat(24)}`,
        changedPaths: [],
      }),
    ).rejects.toThrow("does not attest");
  });
});
