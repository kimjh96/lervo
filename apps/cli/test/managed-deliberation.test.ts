import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { defaultEnglishWritingContract } from "@lervo/core";
import {
  QueuedConversationDeliberationBackend,
  reconcileConversationDeliberation,
  runConversationDeliberationResumeWorkerCycle,
  runConversationDeliberationWorkerCycle,
} from "@lervo/conversation-control";
import {
  SQLiteConversationDeliberationJobStore,
  SQLiteConversationDeliberationResumeJobStore,
} from "@lervo/conversation-deliberation-sqlite";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { createManagedConversationDeliberationExecutionAdapter } from
  "../src/conversation-deliberation-executor.js";
import { createManagedConversationDeliberationReconciliationSource } from
  "../src/conversation-deliberation-reconciliation.js";
import { createManagedConversationDeliberationResumeExecutionAdapter } from
  "../src/conversation-deliberation-resume-executor.js";
import { inspectManagedDeliberation } from "../src/deliberation-inspection.js";
import {
  createAssignedManagedDeliberationExecutor,
  createManagedDeliberationExecutor,
  DeliberationProcessInterruptedError,
} from "../src/managed-deliberation.js";
import { parseSemanticEvaluation } from "../src/managed-deliberation-runner.js";
import type { RunProvider } from "../src/managed-run.js";
import { runCli } from "../src/main.js";
import { prepareRunVerification } from "../src/run-verification.js";
import {
  cleanupManagedDeliberationFixtures,
  clock,
  FixtureDeliberationAdapter,
  repository,
  semanticPass,
  sequence,
  writeFourRolePolicy,
} from "./managed-deliberation-test-fixture.js";

afterEach(cleanupManagedDeliberationFixtures);

describe("managed CLI deliberation convergence", () => {
  it("accepts only an exact, complete semantic writing evaluation", () => {
    const request = {
      writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
      locale: "ko-KR",
      surface: "chat" as const,
      artifactId: "art_semantic_input_0001",
      contentHash: `sha256:${"1".repeat(64)}`,
      content: "This English sentence is ready for review.",
      checks: defaultEnglishWritingContract.verification.semanticChecks,
    };
    expect(parseSemanticEvaluation(semanticPass(), request, "claude").checks)
      .toHaveLength(request.checks.length);
    expect(() => parseSemanticEvaluation(
      `\`\`\`json\n${semanticPass()}\n\`\`\``,
      request,
      "claude",
    )).toThrow("not a JSON object");
    expect(() => parseSemanticEvaluation(
      JSON.stringify({ checks: JSON.parse(semanticPass()).checks.slice(1) }),
      request,
      "claude",
    )).toThrow("does not include every required check");
  });

  it("converges through independent Codex and Claude sessions with real verification", async () => {
    const root = await repository();
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "Each role should read the same repository evidence in a separate session. Every record remains linked to verification results.",
        pass,
        pass,
        "The decision preserves independent sessions and separate context evidence. Repository verification passed, so this scope can be adopted.",
      ],
      claude: [
        pass,
        "Verdict: approved\n\nThe proposal separates each role session and its context evidence. No blocking issue remains in the reviewed scope.",
        "Repository verification runs the actual command separately. Its passing result supports only the current proposal.",
        pass,
      ],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner: {
        createAdapter: ({ provider }) => {
          const content = queues[provider].shift();
          if (content === undefined) throw new Error(`The ${provider} fixture response is missing.`);
          return new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            content,
            nextId("ctx"),
          );
        },
        createId: nextId,
        now,
        prepareVerification: prepareRunVerification,
      },
    });
    const result = await executor({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "Decide how two providers review the same context independently.",
    });

    expect(result.status).toBe("converged");
    expect(result.artifactCount).toBe(4);
    expect(queues).toEqual({ codex: [], claude: [] });
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded"))
      .toHaveLength(4);
    expect(events.filter((event) => event.type === "context.published")).toHaveLength(4);
    expect(events.filter((event) => event.type === "handoff.created")).toHaveLength(8);
    expect(events.filter((event) => event.type === "verification.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "deliberation.completed")[0]?.payload)
      .toMatchObject({ status: "converged" });
    const sessions = events
      .filter((event) => event.type === "adapter.started")
      .map((event) => event.payload.providerSessionId);
    expect(new Set(sessions).size).toBe(8);
    expect(JSON.stringify(events)).not.toContain(result.finalContent);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    await storage.close();

    const deliberationRoots = await readdir(resolve(root, ".lervo/state/deliberations"));
    expect(deliberationRoots).toHaveLength(1);
    const entries = await readdir(
      resolve(root, ".lervo/state/deliberations", deliberationRoots[0]!),
    );
    expect(entries.filter((entry) => entry.startsWith("artifact-"))).toHaveLength(4);
  });

});
