import { resolve } from "node:path";

import {
  QueuedConversationDeliberationBackend,
  reconcileConversationDeliberation,
  runConversationDeliberationWorkerCycle,
} from "@lervo/conversation-control";
import { SQLiteConversationDeliberationJobStore } from "@lervo/conversation-deliberation-sqlite";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { createManagedConversationDeliberationExecutionAdapter } from "../src/conversation-deliberation-executor.js";
import { createManagedConversationDeliberationReconciliationSource } from "../src/conversation-deliberation-reconciliation.js";
import {
  createAssignedManagedDeliberationExecutor,
  createManagedDeliberationExecutor,
} from "../src/managed-deliberation.js";
import type { RunProvider } from "../src/managed-run.js";
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

describe("managed CLI deliberation policies", () => {
  it("runs every role in a stored four-role policy with separate context evidence", async () => {
    const root = await repository();
    await writeFourRolePolicy(root);
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "The proposal defines user value and scope first, then links each review basis to a separate record.",
        pass,
        "Verdict: approved\n\nThe link between repository evidence and claims is clear, with no remaining blocker in scope.",
        pass,
        "The conclusion preserves independent sessions for all four roles together with actual verification results. Its scope is explicit.",
      ],
      claude: [
        pass,
        "Verdict: approved\n\nResponsibilities are separated by role and execution stage, with no blocker that increases long-term change cost.",
        pass,
        "Project verification is linked to actual command results and the current repository revision. It makes no claims beyond the passing scope.",
        pass,
      ],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createAssignedManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner: {
        createAdapter: ({ provider }) =>
          new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            queues[provider].shift() ?? "",
            nextId("ctx"),
          ),
        createId: nextId,
        now,
        prepareVerification: prepareRunVerification,
      },
    });

    const adapter = createManagedConversationDeliberationExecutionAdapter({
      projects: [{ projectId: "prj_cli_deliberation", repositoryRoot: root }],
      executeAssigned: executor,
    });
    const queue = await SQLiteConversationDeliberationJobStore.open({
      path: resolve(root, ".lervo/state/conversation-deliberations.sqlite"),
    });
    const backend = new QueuedConversationDeliberationBackend(queue);
    const started = await backend.start({
      projectId: "prj_cli_deliberation",
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"a".repeat(64)}`,
      policyId: "deliberation_product-review",
      topic: "Decide how multiple specialist roles independently inspect the same public evidence.",
      requestedAt: "2026-08-21T00:00:00.000Z",
    });
    const cycle = await runConversationDeliberationWorkerCycle({
      store: queue,
      executor: adapter,
      workerId: "managed-conversation-worker",
      now,
    });
    if (cycle.status !== "settled")
      throw new Error("The conversation deliberation queue did not settle.");
    const result = cycle.summary;

    expect(result.deliberationId).toBe(started.deliberationId);
    expect(result.status).toBe("converged");
    expect(result.artifactCount).toBe(5);
    expect(queues).toEqual({ codex: [], claude: [] });
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "context.published")).toHaveLength(5);
    expect(events.filter((event) => event.type === "handoff.created")).toHaveLength(20);
    expect(events.filter((event) => event.type === "verification.completed")).toHaveLength(1);
    const sessions = events
      .filter((event) => event.type === "adapter.started")
      .map((event) => event.payload.providerSessionId);
    expect(
      new Set(
        events.flatMap((event) =>
          event.type === "run.requested" && event.payload.role !== "deliberation-writing-evaluator"
            ? [event.payload.role]
            : [],
        ),
      ),
    ).toEqual(
      new Set([
        "product-planner",
        "maintainability-reviewer",
        "evidence-reviewer",
        "project-verifier",
      ]),
    );
    expect(sessions).toHaveLength(10);
    expect(new Set(sessions).size).toBe(10);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    await storage.close();
    await expect(
      backend.start({
        projectId: "prj_cli_deliberation",
        principalId: "operator:reviewer",
        sourceEventId: `cve_${"a".repeat(64)}`,
        policyId: "deliberation_product-review",
        topic:
          "Decide how multiple specialist roles independently inspect the same public evidence.",
        requestedAt: "2026-08-21T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      deliberationId: started.deliberationId,
      status: "converged",
    });
    queue.close();
    const replacementQueue = await SQLiteConversationDeliberationJobStore.open({
      path: resolve(root, ".lervo/state/replacement-conversation-deliberations.sqlite"),
    });
    const replacementBackend = new QueuedConversationDeliberationBackend(replacementQueue);
    const replacement = await replacementBackend.start({
      projectId: "prj_cli_deliberation",
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"a".repeat(64)}`,
      policyId: "deliberation_product-review",
      topic: "Decide how multiple specialist roles independently inspect the same public evidence.",
      requestedAt: "2026-08-21T00:00:00.000Z",
    });
    expect(replacement.deliberationId).toBe(started.deliberationId);
    await expect(
      runConversationDeliberationWorkerCycle({
        store: replacementQueue,
        executor: adapter,
        workerId: "replacement-managed-worker",
        now,
      }),
    ).resolves.toMatchObject({
      status: "uncertain",
      deliberationId: started.deliberationId,
    });
    const reconciled = await reconcileConversationDeliberation({
      store: replacementQueue,
      source: createManagedConversationDeliberationReconciliationSource({
        projects: [{ projectId: "prj_cli_deliberation", repositoryRoot: root }],
      }),
      projectId: "prj_cli_deliberation",
      deliberationId: replacement.deliberationId,
      now,
    });
    expect(reconciled).toMatchObject({
      status: "reconciled",
      summary: {
        deliberationId: started.deliberationId,
        status: "converged",
        artifactCount: 5,
      },
    });
    await expect(
      replacementQueue.inspect({
        projectId: "prj_cli_deliberation",
        deliberationId: replacement.deliberationId,
      }),
    ).resolves.toMatchObject({
      state: "settled",
      failureCode: null,
      reconciliation: {
        sourceKind: "managed_deliberation_inspection_v1",
        priorFailureCode: "deliberation_execution_uncertain",
      },
    });
    replacementQueue.close();
    const unchanged = await openProjectStorage(root);
    expect(
      unchanged.events
        .list({ limit: 1000 })
        .filter((event) => event.type === "deliberation.started"),
    ).toHaveLength(1);
    expect(unchanged.events.verifyIntegrity().valid).toBe(true);
    await unchanged.close();
    const mismatchedProject = createManagedConversationDeliberationExecutionAdapter({
      projects: [{ projectId: "prj_wrongproject1", repositoryRoot: root }],
      executeAssigned: executor,
    });
    await expect(
      mismatchedProject.execute({
        operation: "start",
        projectId: "prj_wrongproject1",
        sourceEventId: `cve_${"d".repeat(64)}`,
        deliberationId: `dlb_${"e".repeat(32)}`,
        requestHash: `sha256:${"f".repeat(64)}`,
        principalHash: `sha256:${"1".repeat(64)}`,
        policyId: "deliberation_product-review",
        topic: "Do not start a provider in a mismatched repository.",
        requestedAt: "2026-08-21T00:11:00.000Z",
        state: "leased",
        attemptCount: 1,
        leaseExpiresAt: "2026-08-21T00:16:00.000Z",
        summary: null,
        failureCode: null,
        reconciliation: null,
      }),
    ).rejects.toMatchObject({ code: "deliberation_project_mismatch" });
  });

  it("stops as no_consensus after the second blocking review", async () => {
    const root = await repository();
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "The first proposal has each role reread repository context. Every role leaves an independent execution record.",
        pass,
        "The revision requires a separate receipt for every role and links each review result into the next role's input.",
        pass,
      ],
      claude: [
        pass,
        "Verdict: revision required\n\nThe first proposal does not explain how verification supports the conclusion, so it cannot be adopted.",
        pass,
        "Verdict: revision required\n\nThe revision still lacks a rule for failed verification, so the blocking objection remains.",
      ],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner: {
        createAdapter: ({ provider }) =>
          new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            queues[provider].shift() ?? "",
            nextId("ctx"),
          ),
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
      topic: "Do not treat the result as a conclusion while a blocking objection remains.",
    });

    expect(result.status).toBe("no_consensus");
    expect(result.outcome).toMatchObject({
      status: "no_consensus",
      noConsensusReason: "blocking_objections_unresolved",
      decisionArtifactId: null,
    });
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(events.some((event) => event.type === "verification.started")).toBe(false);
    expect(
      events.filter((event) => event.type === "deliberation.completed")[0]?.payload,
    ).toMatchObject({ status: "no_consensus" });
    await storage.close();
  });

  it("does not turn an unstructured reviewer sentence into approval", async () => {
    const root = await repository();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "The proposal has every role inspect the shared context directly. Each session records separate evidence.",
      ],
      claude: [
        semanticPass(),
        "I agree with the proposal. This sentence does not use the structured approval marker.",
      ],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner: {
        createAdapter: ({ provider }) =>
          new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            queues[provider].shift() ?? "",
            nextId("ctx"),
          ),
        createId: nextId,
        now,
        prepareVerification: prepareRunVerification,
      },
    });

    await expect(
      executor({
        repositoryRoot: root,
        proposerProvider: "codex",
        reviewerProvider: "claude",
        verificationSuiteIds: ["project.default"],
        topic: "Do not infer approval from free-form prose.",
      }),
    ).rejects.toThrow(
      "The first review line must be 'Verdict: approved' or 'Verdict: revision required'",
    );

    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded")).toHaveLength(
      1,
    );
    expect(
      events.filter((event) => event.type === "deliberation.completed")[0]?.payload,
    ).toMatchObject({ status: "failed", failureCode: "deliberation_failed" });
    expect(events.some((event) => event.type === "verification.started")).toBe(false);
    await storage.close();
  });
});
