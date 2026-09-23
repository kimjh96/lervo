import { describe, expect, it } from "vitest";

import { verifyConversationRepositoryWorkCompletion } from "../src/conversation-repository-work-completion.js";

describe("conversation repository work completion", () => {
  it("rejects incomplete changed-path evidence before opening repository storage", async () => {
    await expect(
      verifyConversationRepositoryWorkCompletion({
        repositoryRoot: "/nonexistent/repository",
        provider: "codex",
        baseline: { workstreamId: null, workstreamRevision: null, knowledgeCurrent: false },
        repositoryChange: {
          repositoryRevisionBefore: `sha256:${"a".repeat(64)}`,
          repositoryRevisionAfter: `sha256:${"b".repeat(64)}`,
          changedPaths: Array.from({ length: 65 }, (_, index) => `src/change-${index}.ts`),
        },
        sourceConversationEventId: "cve_source",
        workerAgentId: "agt_worker",
        providerSessionId: "session",
        requestedModel: null,
        requestedReasoningEffort: null,
        executionProfile: null,
        allocationReason: "configured_default",
        requestContentHash: `sha256:${"c".repeat(64)}`,
        result: { contentHash: `sha256:${"d".repeat(64)}`, byteCount: 1, summary: "done" },
        completedAt: "2026-09-23T00:00:00.000Z",
        replicaConfigured: false,
        checkpointDisposition: "not_observed",
      }),
    ).rejects.toMatchObject({ code: "repository_changed_path_limit_exceeded" });
  });
});
