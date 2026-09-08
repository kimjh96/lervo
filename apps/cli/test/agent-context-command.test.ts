import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];
const hash = (character: string) => `sha256:${character.repeat(64)}`;

function io(cwd: string, stdout: string[] = [], stdin?: string, stderr: string[] = []) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
    ...(stdin === undefined ? {} : { stdin: async () => stdin }),
  };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("agent context CLI", () => {
  it("promotes reviewed evidence and explicitly hands it to a successor", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-context-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "agent-context"], io(root))).toBe(0);
    const ownerOutput: string[] = [];
    const successorOutput: string[] = [];
    expect(
      await runCli(
        ["agent", "hire", "--role", "developer", "--write", "--json"],
        io(root, ownerOutput),
      ),
    ).toBe(0);
    expect(
      await runCli(
        ["agent", "hire", "--role", "researcher", "--write", "--json"],
        io(root, successorOutput),
      ),
    ).toBe(0);
    const owner = JSON.parse(ownerOutput.join("")) as { agentId: string };
    const successor = JSON.parse(successorOutput.join("")) as { agentId: string };
    let reviewEventId: string;
    let reviewEventHash: string;
    const storage = await openProjectStorage(root);
    try {
      const result = await storage.artifacts.put("verification passed");
      const appended = storage.events.append({
        eventId: "evt_contextreview01",
        projectId: storage.manifest.projectId,
        runId: "run_contextreview01",
        sessionId: "ses_contextreview01",
        type: "verification.completed",
        occurredAt: "2026-09-09T00:00:00.000Z",
        actor: { kind: "system" },
        schemaVersion: 1,
        policyVersion: hash("a"),
        payload: {
          verificationId: `ver_${"b".repeat(16)}`,
          suiteId: "agent.context",
          suiteHash: hash("c"),
          repositoryRevision: hash("d"),
          status: "passed",
          resultArtifactId: `art_${result.contentHash.slice("sha256:".length)}`,
          resultContentHash: result.contentHash,
          nonPassedCommandIds: [],
        },
      });
      reviewEventId = appended.event.eventId;
      reviewEventHash = appended.event.eventHash;
    } finally {
      await storage.close();
    }

    const promotedOutput: string[] = [];
    const promotedErrors: string[] = [];
    const promotedExit = await runCli(
      [
        "agent",
        "context",
        "promote",
        "--agent",
        owner.agentId,
        "--layer",
        "expertise",
        "--source-kind",
        "event",
        "--source-id",
        reviewEventId!,
        "--source-hash",
        reviewEventHash!,
        "--review-event",
        reviewEventId!,
        "--summary-stdin",
        "--write",
        "--json",
      ],
      io(root, promotedOutput, "Prefer exact source-bound evidence.", promotedErrors),
    );
    expect(promotedErrors).toEqual([]);
    expect(promotedExit).toBe(0);
    const promoted = JSON.parse(promotedOutput.join("")) as {
      entries: Array<{ contextEntryId: string }>;
    };
    expect(promoted.entries).toHaveLength(1);

    const handoffOutput: string[] = [];
    expect(
      await runCli(
        [
          "agent",
          "context",
          "handoff",
          "--from-agent",
          owner.agentId,
          "--to-agent",
          successor.agentId,
          "--entry",
          promoted.entries[0]!.contextEntryId,
          "--write",
          "--json",
        ],
        io(root, handoffOutput),
      ),
    ).toBe(0);
    expect(JSON.parse(handoffOutput.join(""))).toMatchObject({
      agent: { agentId: successor.agentId },
      inheritedEntries: [{ contextEntryId: promoted.entries[0]!.contextEntryId }],
      incomingHandoffs: [{ fromAgentId: owner.agentId, toAgentId: successor.agentId }],
    });
  });
});
