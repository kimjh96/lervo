import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ConversationDeliberationCliProcess } from "../src/conversation-deliberation-cli-executor.js";
import { createConversationDeliberationResultSource } from "../src/conversation-deliberation-result-source.js";

describe("conversation deliberation result source", () => {
  it("reads the writing-gated terminal decision from canonical artifact evidence", async () => {
    const content = "Adopt the reviewed product boundary.";
    const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const run = vi
      .fn<ConversationDeliberationCliProcess["run"]>()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          projectId: "prj_control01",
          deliberationId: "dlb_queue0001",
          sourceStatus: "consistent",
          phase: "completed",
          completionStatus: "converged",
          events: [
            {
              seq: 3,
              type: "deliberation.artifact.recorded",
              payload: {
                deliberationArtifactId: "dla_decision0001",
                kind: "decision",
                contentHash,
              },
            },
            {
              seq: 4,
              type: "deliberation.completed",
              payload: { decisionArtifactId: "dla_decision0001" },
            },
          ],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          contentHash,
          recoveryStatus: "recovered",
          content,
        }),
        stderr: "",
      });
    const source = createConversationDeliberationResultSource({
      executable: "/opt/lervo/bin/lervo",
      repositoryRoot: "/srv/project",
      process: { run },
    });

    await expect(
      source.read({
        projectId: "prj_control01",
        deliberationId: "dlb_queue0001",
      }),
    ).resolves.toEqual({ status: "converged", content });
    expect(run).toHaveBeenNthCalledWith(2, {
      executable: "/opt/lervo/bin/lervo",
      args: [
        "deliberate",
        "artifact",
        "--content-hash",
        contentHash,
        "--root",
        "/srv/project",
        "--json",
      ],
      stdin: "",
      timeoutMs: 60_000,
    });
  });

  it("rejects a terminal result whose artifact bytes do not match the recorded hash", async () => {
    const recordedContent = "Recorded decision.";
    const recordedHash = `sha256:${createHash("sha256").update(recordedContent).digest("hex")}`;
    const run = vi
      .fn<ConversationDeliberationCliProcess["run"]>()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          projectId: "prj_control01",
          deliberationId: "dlb_queue0001",
          sourceStatus: "consistent",
          phase: "completed",
          completionStatus: "converged",
          events: [
            {
              seq: 1,
              type: "deliberation.artifact.recorded",
              payload: {
                deliberationArtifactId: "dla_decision0001",
                kind: "decision",
                contentHash: recordedHash,
              },
            },
            {
              seq: 2,
              type: "deliberation.completed",
              payload: { decisionArtifactId: "dla_decision0001" },
            },
          ],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          schemaVersion: 1,
          contentHash: recordedHash,
          recoveryStatus: "recovered",
          content: "Different bytes.",
        }),
        stderr: "",
      });
    const source = createConversationDeliberationResultSource({
      executable: "/opt/lervo/bin/lervo",
      repositoryRoot: "/srv/project",
      process: { run },
    });

    await expect(
      source.read({ projectId: "prj_control01", deliberationId: "dlb_queue0001" }),
    ).rejects.toThrow("artifact evidence is invalid");
  });
});
