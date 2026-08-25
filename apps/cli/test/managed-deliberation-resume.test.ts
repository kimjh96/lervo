import { resolve } from "node:path";

import { runConversationDeliberationResumeWorkerCycle } from "@lervo/conversation-control";
import { SQLiteConversationDeliberationResumeJobStore } from "@lervo/conversation-deliberation-sqlite";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { createManagedConversationDeliberationResumeExecutionAdapter } from "../src/conversation-deliberation-resume-executor.js";
import { inspectManagedDeliberation } from "../src/deliberation-inspection.js";
import {
  createAssignedManagedDeliberationExecutor,
  createManagedDeliberationExecutor,
  DeliberationProcessInterruptedError,
} from "../src/managed-deliberation.js";
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
} from "./managed-deliberation-test-fixture.js";

afterEach(cleanupManagedDeliberationFixtures);

describe("managed CLI deliberation resume", () => {
  it("resumes from the immutable approved boundary without repeating proposal or review", async () => {
    const root = await repository();
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "Preserve source and execution evidence through approved review, then resume only from that boundary.",
        pass,
        pass,
        "The decision revalidates the approved boundary and resumes only verification and decision steps.",
      ],
      claude: [
        pass,
        "Verdict: approved\n\nRechecking artifacts and events before approval permits continuation without duplicate execution.",
        "Repository verification ran the actual command after resume and passed against the current repository.",
        pass,
      ],
    };
    const nextId = sequence();
    const now = clock();
    const runner = {
      createAdapter: ({ provider }: { provider: RunProvider }) => {
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
    };
    let deliberationId = "";
    let concurrentResumeBlocked = false;
    const interrupted = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner,
      afterApprovedCheckpoint: async (id) => {
        deliberationId = id;
        const inspecting = await openProjectStorage(root);
        const active = await inspectManagedDeliberation({
          storage: inspecting,
          deliberationId: id,
        });
        expect(active).toMatchObject({
          phase: "running_after_approval",
          lease: "active",
          resume: "blocked_running",
        });
        await inspecting.close();
        const contender = createManagedDeliberationExecutor({
          openStorage: openProjectStorage,
          createId: nextId,
          now,
          runner,
        });
        try {
          await contender({ repositoryRoot: root, resumeDeliberationId: id });
        } catch (error) {
          concurrentResumeBlocked =
            (error as { code?: unknown }).code === "deliberation_in_progress";
        }
        throw new DeliberationProcessInterruptedError("fixture interruption");
      },
    });

    await expect(
      interrupted({
        repositoryRoot: root,
        proposerProvider: "codex",
        reviewerProvider: "claude",
        verificationSuiteIds: ["project.default"],
        topic: "Resume deliberation interrupted after an approved review.",
      }),
    ).rejects.toThrow("fixture interruption");
    expect(concurrentResumeBlocked).toBe(true);

    const before = await openProjectStorage(root);
    const beforeEvents = before.events.list({ limit: 1000 });
    expect(
      beforeEvents.filter((event) => event.type === "deliberation.artifact.recorded"),
    ).toHaveLength(2);
    expect(beforeEvents.some((event) => event.type === "deliberation.completed")).toBe(false);
    expect(await inspectManagedDeliberation({ storage: before, deliberationId })).toMatchObject({
      sourceStatus: "consistent",
      phase: "interrupted_after_approval",
      checkpoint: "readable",
      lease: "missing",
      resume: "candidate",
    });
    await before.close();

    let traceOutput = "";
    expect(
      await runCli(["trace", "--deliberation", deliberationId], {
        cwd: root,
        stdout: (message) => {
          traceOutput += message;
        },
        stderr: () => undefined,
      }),
    ).toBe(0);
    expect(traceOutput).toContain("eligible to resume after approval");
    expect(traceOutput).toContain("deliberation.artifact.recorded");

    let doctorOutput = "";
    expect(
      await runCli(["doctor", "--deliberation", deliberationId], {
        cwd: root,
        stdout: (message) => {
          doctorOutput += message;
        },
        stderr: () => undefined,
      }),
    ).toBe(0);
    expect(doctorOutput).toContain("revalidate every source when resuming");

    let statusOutput = "";
    expect(
      await runCli(["deliberate", "status", deliberationId], {
        cwd: root,
        stdout: (message) => {
          statusOutput += message;
        },
        stderr: () => undefined,
      }),
    ).toBe(0);
    expect(statusOutput).toContain("eligible to resume after approval");

    const resumeDependencies = {
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner,
    };
    const mismatchedResume = createManagedConversationDeliberationResumeExecutionAdapter({
      projects: [{ projectId: "prj_wrongproject1", repositoryRoot: root }],
      executeAssignedResume: createAssignedManagedDeliberationExecutor(resumeDependencies),
    });
    await expect(
      mismatchedResume.execute({
        operation: "resume",
        projectId: "prj_wrongproject1",
        sourceEventId: `cve_${"6".repeat(64)}`,
        deliberationId,
        requestHash: `sha256:${"5".repeat(64)}`,
        principalHash: `sha256:${"4".repeat(64)}`,
        requestedAt: now().toISOString(),
        state: "leased",
        attemptCount: 1,
        leaseExpiresAt: now().toISOString(),
        summary: null,
        failureCode: null,
        reconciliation: null,
      }),
    ).rejects.toMatchObject({ code: "deliberation_project_mismatch" });
    const resumeQueue = await SQLiteConversationDeliberationResumeJobStore.open({
      path: resolve(root, ".lervo/state/conversation-deliberation-resumes.sqlite"),
    });
    await resumeQueue.enqueue({
      projectId: "prj_cli_deliberation",
      sourceEventId: `cve_${"9".repeat(64)}`,
      deliberationId,
      requestHash: `sha256:${"8".repeat(64)}`,
      principalHash: `sha256:${"7".repeat(64)}`,
      requestedAt: now().toISOString(),
    });
    const resumeAdapter = createManagedConversationDeliberationResumeExecutionAdapter({
      projects: [{ projectId: "prj_cli_deliberation", repositoryRoot: root }],
      executeAssignedResume: createAssignedManagedDeliberationExecutor(resumeDependencies),
    });
    const resumedCycle = await runConversationDeliberationResumeWorkerCycle({
      store: resumeQueue,
      executor: resumeAdapter,
      workerId: "managed-conversation-resume-worker",
      now,
    });
    if (resumedCycle.status !== "settled")
      throw new Error("The resumed conversation deliberation queue did not settle.");
    const result = resumedCycle.summary;

    expect(result).toMatchObject({ deliberationId, status: "converged", artifactCount: 4 });
    expect(queues).toEqual({ codex: [], claude: [] });
    const after = await openProjectStorage(root);
    const events = after.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "deliberation.started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded")).toHaveLength(
      4,
    );
    expect(events.filter((event) => event.type === "verification.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "deliberation.completed")).toHaveLength(1);
    expect(after.events.verifyIntegrity().valid).toBe(true);
    expect(await inspectManagedDeliberation({ storage: after, deliberationId })).toMatchObject({
      sourceStatus: "consistent",
      phase: "completed",
      completionStatus: "converged",
      resume: "completed",
    });
    await after.close();
    resumeQueue.close();

    const resumed = createManagedDeliberationExecutor(resumeDependencies);
    await expect(
      resumed({ repositoryRoot: root, resumeDeliberationId: deliberationId }),
    ).rejects.toThrow("snapshot");
  });
});
