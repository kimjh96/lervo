import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createVerifiedConversationControlReply } from "@lervo/conversation-control";
import { calculateConversationOutboundId } from "@lervo/conversation-contract";
import type { ConversationOutboundMessage } from "@lervo/schemas";
import { resultWritingContract } from "../src/conversation-result-publication.js";
import type { NodeSupervisionResultDeliveryConfiguration } from "../src/supervision-result-delivery.js";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  loadRepositoryKnowledgePolicy,
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
} from "@lervo/repository-knowledge";
import { listAssignments, reconcileAssignmentCompletion } from "@lervo/agent-workforce";
import {
  supervisedManagedExecutionFields,
  projectOutcomeSupervision,
  completionEvidenceId,
  supervisedArtifactReviewFields,
  supervisedGoalCompletionFields,
  supervisedResultDeliveryFields,
} from "@lervo/work-controller";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { observeSupervisionTasks } from "../src/supervision-task-observation.js";
import type {
  OperatingActionPlanV1,
  SupervisedManagedExecutionV1,
  SupervisedArtifactReviewV1,
  SupervisedGoalCompletionV1,
  SupervisedResultDeliveryV1,
} from "@lervo/application-contract";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { assertCanonicalGoalCompletionBasis } from "../src/supervision-goal-completion-basis.js";
import { inspectGoalCompletion } from "../src/supervision-goal-completion-receipt.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";
import { admitSupervisionRequest } from "../src/supervision-request-intake.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([
  [false, false],
  [true, false],
  [false, true],
])(
  "dispatches the built managed CLI with current write authority (suspend before write: %s, usage: %s)",
  async (suspendBeforeWrite, reportUsage) => {
    const f = await dispatchFixture(
      roots,
      true,
      async (root) => {
        await writeFile(
          resolve(root, "AGENTS.md"),
          "Change only src/save.ts. Preserve the exported value.\n",
        );
        const policy = await loadRepositoryKnowledgePolicy(root);
        policy.normalization = { exclude: ["AGENTS.md"] };
        await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: root }),
          new Date(),
          () => undefined,
        );
        return ["AGENTS.md", ".lervo/.gitignore"];
      },
      "developer",
      ["allocate_existing", "dispatch", "execute_as_owner", "publish_result"],
    );
    let publicationClockOffset = 0;
    const realNow = f.ports.now;
    f.ports.now = () => new Date(Date.parse(realNow()) + publicationClockOffset).toISOString();
    const loginScript = (await readFile(f.login.executable, "utf8")).replace(
      "const args=",
      "function inspectLogin(){\nconst args=",
    );
    let providerScript = (
      await readFile(
        resolve("scripts/distribution/fixtures/installed-capability-codex.mjs"),
        "utf8",
      )
    )
      .replace(/^#![^\n]*\n/u, "")
      .replaceAll("src/result.ts", "src/save.ts");
    if (reportUsage)
      providerScript = providerScript.replace(
        "function completeTurn(content) {",
        `function completeTurn(content) {
  send({method: "thread/tokenUsage/updated", params: {threadId, turnId, tokenUsage: {total: {inputTokens: 40, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0, totalTokens: 50}, modelContextWindow: 100000}}});`,
      );
    if (suspendBeforeWrite) {
      providerScript = providerScript.replace(
        "    pendingMainTurn = true;",
        `    await (await import(${JSON.stringify(new URL("../../../packages/agent-workforce/dist/index.js", import.meta.url).href)})).changeAgentStatus(${JSON.stringify({ repositoryRoot: f.root, agentId: f.owner.agentId, expectedRevision: 1, status: "suspended" })});\n    pendingMainTurn = true;`,
      );
    }
    const promptLog = resolve(f.login.context.homeDirectory, "prompt.log");
    await writeFile(
      f.login.executable,
      `${loginScript}\n}\nif(process.argv[2]!=="app-server")inspectLogin();\nprocess.env.LERVO_INSTALLED_CAPABILITY_TARGET=process.cwd()+"/src/save.ts";\nprocess.env.LERVO_INSTALLED_CAPABILITY_PROMPT_LOG=${JSON.stringify(promptLog)};\nprocess.env.LERVO_INSTALLED_CAPABILITY_CHANGE_KIND="update";\nprocess.env.LERVO_INSTALLED_CAPABILITY_CONTENT="export const saved = 'verified';\\n";\n${providerScript}`,
    );
    const effect: SupervisedManagedExecutionV1 = {
      schemaVersion: 1,
      kind: "work.managed_execution",
      responsibility: f.task,
      leaseId: f.assignment.lease!.leaseId,
      provider: "codex",
      instructions: "Update the saved value in src/save.ts and verify the result.",
      risk: "low",
      reservedTokens: 100,
    };
    const storage = await openProjectStorage(f.root);
    await storage.artifacts.put(canonicalJson(effect));
    const propose = f.ports.propose;
    const tasks = new SupervisionTaskSource(storage, f.binding, f.ports.now);
    let dispatchedPlan: OperatingActionPlanV1 | undefined;
    let nextReview: SupervisedArtifactReviewV1 | null = null;
    let nextDelivery: SupervisedResultDeliveryV1 | null = null;
    let nextGoal: SupervisedGoalCompletionV1 | null = null;
    let goalPlan: OperatingActionPlanV1 | undefined;
    f.ports.propose = async (report) => {
      if (nextDelivery !== null && report.nextAction === "publish_result")
        return {
          ...(await propose(report))!,
          ...supervisedResultDeliveryFields(nextDelivery),
          graphHash: (await tasks.read()).graph.graphHash,
        };
      if (nextGoal !== null && report.nextAction === "complete_workstream")
        return (goalPlan = {
          ...(await propose(report))!,
          ...supervisedGoalCompletionFields(nextGoal),
          graphHash: (await tasks.read()).graph.graphHash,
        });
      if (nextReview !== null && report.nextAction === "review_artifacts")
        return {
          ...(await propose(report))!,
          ...supervisedArtifactReviewFields(nextReview),
          graphHash: (await tasks.read()).graph.graphHash,
        };
      const plan = {
        ...(await propose(report))!,
        ...supervisedManagedExecutionFields(effect),
        graphHash: (await tasks.read()).graph.graphHash,
      };
      dispatchedPlan ??= plan;
      return plan;
    };
    f.ports.execute = async () => {
      throw new Error("The concrete managed adapter must own dispatch.");
    };
    const sent: ConversationOutboundMessage[] = [];
    const origin = {
      sourceEventId: `cve_${"3".repeat(64)}`,
      policyId: `cpp_${"4".repeat(64)}`,
      target: {
        integrationId: "itg_supervisionresult",
        projectId: storage.manifest.projectId,
        conversationId: "cnv_supervisionresult",
        threadId: null,
      },
      actor: { kind: "agent", participantId: "ptc_supervisionowner", roleId: f.owner.roleId },
    } as const;
    const dynamicOrigin = !suspendBeforeWrite && !reportUsage;
    if (dynamicOrigin) {
      await admitSupervisionRequest({
        repositoryRoot: f.root,
        binding: f.binding,
        request: {
          source: "discord",
          sourceId: origin.sourceEventId,
          requesterId: "ptc_supervisionrequester:owner",
          request: "Complete the installed managed goal.",
          contentHash: `sha256:${createHash("sha256")
            .update("Complete the installed managed goal.")
            .digest("hex")}`,
          origin,
        },
      });
    }
    const resultDelivery: NodeSupervisionResultDeliveryConfiguration = {
      ...(dynamicOrigin ? {} : { origin }),
      adapter: {
        descriptor: {
          schemaVersion: 1,
          integrationId: "itg_supervisionresult",
          adapterKind: "discord",
          instanceIdentityHash: `sha256:${"c".repeat(64)}`,
          capabilities: ["messages.send"],
        },
        deliver: async (outbound) => {
          sent.push(structuredClone(outbound));
          if (sent.length === 1) throw new Error("Test transport unavailable.");
          return {
            schemaVersion: 1,
            outboundId: outbound.outboundId,
            integrationId: outbound.target.integrationId,
            deliveryKeyHash: `sha256:${"d".repeat(64)}`,
            deliveredAt: f.ports.now(),
          };
        },
      },
    };
    const openRuntime = () =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: {
          now: f.ports.now,
          propose: f.ports.propose,
          execute: f.ports.execute,
          inspectEffect: f.ports.inspectEffect,
          recordAttention: f.ports.recordAttention,
        },
        runtimeReadiness: f.runtimeReadiness,
        resultDelivery,
        managedExecution: {
          nodeExecutable: process.execPath,
          cliBundle: resolve("apps/cli/dist/bin.js"),
        },
      });
    let runtime = await openRuntime();
    try {
      const cycle = await runtime.runCycle();
      const events = storage.events.list({ limit: 1000 });
      expect(
        cycle.disposition,
        JSON.stringify({
          cycle,
          attention: f.attention,
          events: events.map((event) => ({ type: event.type, failure: event.payload.failureCode })),
        }),
      ).toBe("effect_confirmed");
      expect(events.some((event) => event.type === "adapter.started")).toBe(true);
      if (suspendBeforeWrite) {
        expect(events.some((event) => event.type === "run.failed")).toBe(true);
        expect(events.some((event) => event.type === "file.changed")).toBe(false);
        expect(await readFile(resolve(f.workspacePath, "src/save.ts"), "utf8")).toBe(
          "export const saved = true;\n",
        );
        return;
      }
      expect(events.some((event) => event.type === "run.completed")).toBe(true);
      // Only an actual normalized provider counter establishes observed usage.
      expect(await tasks.readAdmission(dispatchedPlan!)).toMatchObject({
        observedAggregateTokens: reportUsage ? 50 : null,
        resourceAdmission: reportUsage ? "within" : "unobserved",
        assignmentCount: 1,
        activeAttempts: 0,
      });
      let delayedNow = Date.now();
      const delayedTasks = new SupervisionTaskSource(storage, f.binding, () =>
        new Date(delayedNow).toISOString(),
      );
      const read = delayedTasks.read.bind(delayedTasks);
      let reads = 0;
      vi.spyOn(delayedTasks, "read").mockImplementation(async (...args) => {
        const current = await read(...args);
        if (++reads === 2) delayedNow += 6_000;
        return current;
      });
      const delayedAdmission = await delayedTasks.readAdmission(dispatchedPlan!);
      expect(reads).toBe(2);
      expect(delayedAdmission.observedAt).toBe(new Date(delayedNow).toISOString());
      await expect(tasks.readAdmission({ ...dispatchedPlan!, reservedTokens: 1 })).rejects.toThrow(
        "exact effect",
      );
      const snapshot = await new SupervisionTaskSource(
        storage,
        f.binding,
        f.ports.now,
      ).readSnapshot();
      expect(snapshot.assignments[0]).toMatchObject({
        status: "leased",
        effectDisposition: "reconciled",
        review: null,
        startedAt: expect.any(String),
        terminalEventId: expect.any(String),
        artifactHashes: [expect.stringMatching(/^sha256:/u)],
        verification: [expect.objectContaining({ suiteId: "save.restart", status: "passed" })],
      });
      expect(
        projectOutcomeSupervision({ snapshot, now: f.ports.now(), maximumRecoveryDecisions: 1 })
          .nextAction,
      ).toBe("review_artifacts");
      expect(await readFile(resolve(f.workspacePath, "src/save.ts"), "utf8")).toBe(
        "export const saved = 'verified';\n",
      );
      expect(await readFile(resolve(f.root, "src/save.ts"), "utf8")).toBe(
        "export const saved = true;\n",
      );
      expect(
        (await listAssignments(f.root)).find(
          (item) => item.assignmentId === f.assignment.assignmentId,
        )?.status,
      ).toBe("leased");
      const prompt = await readFile(promptLog, "utf8");
      await runtime.runCycle();
      expect(await readFile(promptLog, "utf8")).toBe(prompt);
      const completed = events.find((event) => event.type === "run.completed")!;
      const coordinate = {
        workstreamId: f.binding.workstreamId,
        assignmentId: f.assignment.assignmentId,
        assignmentRevision: f.assignment.revision,
        agentId: f.task.executorAgentId,
        leaseId: f.assignment.lease!.leaseId,
        runId: completed.runId,
        sessionId: completed.sessionId,
        resultArtifactId: `art_${String(completed.payload.resultDigest).slice(7)}`,
        resultContentHash: String(completed.payload.resultDigest),
        preparedAt: new Date().toISOString(),
      };
      const evidenceId = completionEvidenceId(coordinate);
      const { runId, sessionId, ...payload } = coordinate;
      // Seed the independently admitted publication preparation; worker success does not create it.
      storage.events.append({
        eventId: `evt_${"e".repeat(32)}`,
        projectId: storage.manifest.projectId,
        runId,
        sessionId,
        type: "assignment.completion.prepared",
        schemaVersion: 3,
        occurredAt: coordinate.preparedAt,
        actor: { kind: "system" },
        policyVersion: f.binding.mandateHash,
        payload: {
          ...payload,
          completionEvidenceId: evidenceId,
          verificationStatus: "passed",
          writingPublicationStatus: "allowed",
        },
      });
      let completionTransitionDigest: string | undefined;
      await reconcileAssignmentCompletion({
        repositoryRoot: f.root,
        ...coordinate,
        completionEvidenceId: evidenceId,
        reconciliationCommandId: `gcr_${"e".repeat(24)}`,
        sourceRunId: runId,
        resultArtifact: {
          artifactId: coordinate.resultArtifactId,
          contentHash: coordinate.resultContentHash,
        },
        recordEvent: async (event) => {
          completionTransitionDigest = (await tasks.read()).sourceRevisionDigest;
          storage.events.append({
            eventId: `evt_${"f".repeat(32)}`,
            projectId: storage.manifest.projectId,
            runId: `run_${"f".repeat(32)}`,
            sessionId,
            type: event.type,
            schemaVersion: 3,
            occurredAt: event.occurredAt,
            actor: { kind: "system" },
            policyVersion: f.binding.mandateHash,
            payload: event.payload,
          });
        },
      });
      const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
      expect(source.sourceRevisionDigest).not.toBe(completionTransitionDigest);
      const reconciled = await observeSupervisionTasks(
        source,
        storage.artifacts,
        f.binding,
        storage.events,
      );
      expect(reconciled.unboundAssignmentIds).toEqual([]);
      expect(reconciled.assignments[0]).toMatchObject({
        status: "completed",
        revision: f.task.assignmentRevision + 1,
        review: null,
      });
      for (const change of [
        "missing_event",
        "different_result",
        "later_revision",
        "changed_duty",
      ] as const) {
        const stale = structuredClone(source);
        if (change === "missing_event")
          stale.events = stale.events.filter(
            (event) => event.type !== "assignment.completion.reconciled",
          );
        if (change === "different_result") stale.assignments[0]!.resultArtifacts = [];
        if (change === "later_revision") stale.assignments[0]!.revision += 1;
        if (change === "changed_duty")
          stale.assignments[0]!.acceptanceCriteria = ["A different duty."];
        expect(
          (await observeSupervisionTasks(stale, storage.artifacts, f.binding, storage.events))
            .unboundAssignmentIds,
          change,
        ).toEqual([f.assignment.assignmentId]);
      }
      const assignment = reconciled.assignments[0]!;
      const rationale = await storage.artifacts.put(
        canonicalJson(
          "The observed saved value and required verification meet the exact assignment criteria.",
        ),
      );
      nextReview = {
        schemaVersion: 1,
        kind: "work.artifact_review",
        assignmentId: assignment.assignmentId,
        assignmentRevision: assignment.revision,
        responsibilityArtifactHash: assignment.responsibilityArtifactHash,
        terminalEventId: assignment.terminalEventId!,
        reviewerAgentId: f.binding.ownerAgentId,
        acceptanceHash: assignment.acceptanceHash,
        artifactHashes: assignment.artifactHashes,
        verificationEventIds: assignment.verification.map((item) => item.eventId),
        verdict: "accepted",
        rationaleArtifactHash: rationale.contentHash,
      };
      await storage.artifacts.put(canonicalJson(nextReview));
      expect((await listAssignments(f.root))[0]?.lease).toBeNull();
      const reviewCycle = await runtime.runCycle();
      expect(reviewCycle.disposition, JSON.stringify({ reviewCycle, attention: f.attention })).toBe(
        reportUsage ? "effect_confirmed" : "blocked",
      );
      const accepted = await tasks.readSnapshot();
      expect(accepted.assignments[0]?.review?.verdict ?? null).toBe(
        reportUsage ? "accepted" : null,
      );
      if (reportUsage) {
        const migratedSource = structuredClone(await tasks.read());
        const migratedAssignment = migratedSource.assignments[0]!;
        const settledRevision = migratedAssignment.revision;
        const previousRoleContractHash = migratedAssignment.roleContractHash;
        const roleContractHash = `sha256:${"7".repeat(64)}`;
        const occurredAt = new Date(Date.parse(migratedAssignment.updatedAt) + 1).toISOString();
        migratedAssignment.revision += 1;
        migratedAssignment.roleContractHash = roleContractHash;
        migratedAssignment.updatedAt = occurredAt;
        const previous = migratedSource.events.at(-1)!;
        migratedSource.events.push({
          eventId: `evt_${"7".repeat(32)}`,
          projectId: previous.projectId,
          seq: previous.seq + 1,
          runId: `run_${"7".repeat(32)}`,
          sessionId: `ses_${"7".repeat(32)}`,
          type: "assignment.role.binding.changed",
          occurredAt,
          actor: { kind: "system" },
          schemaVersion: 3,
          policyVersion: f.binding.mandateHash,
          payload: {
            assignmentId: migratedAssignment.assignmentId,
            previousRoleVersion: migratedAssignment.roleVersion,
            previousRoleContractHash,
            previousRequiredCapabilityHash: migratedAssignment.requiredCapabilityHash ?? null,
            roleId: migratedAssignment.roleId,
            roleVersion: migratedAssignment.roleVersion,
            roleContractHash,
            requiredCapabilityHash: migratedAssignment.requiredCapabilityHash ?? null,
            revision: migratedAssignment.revision,
          },
          previousHash: previous.eventHash,
          eventHash: `sha256:${"7".repeat(64)}`,
        });
        const migrated = await observeSupervisionTasks(
          migratedSource,
          storage.artifacts,
          f.binding,
          storage.events,
        );
        expect(migrated.unboundAssignmentIds).toEqual([]);
        expect(migrated.assignments[0]).toMatchObject({
          revision: settledRevision,
          review: { verdict: "accepted" },
        });
        migratedSource.assignments[0]!.revision += 1;
        expect(
          (
            await observeSupervisionTasks(
              migratedSource,
              storage.artifacts,
              f.binding,
              storage.events,
            )
          ).unboundAssignmentIds,
        ).toEqual([migratedAssignment.assignmentId]);
      }
      expect(accepted.delivery).toBe("not_attempted");
      expect(
        projectOutcomeSupervision({
          snapshot: accepted,
          now: f.ports.now(),
          maximumRecoveryDecisions: 1,
        }).nextAction,
      ).toBe(reportUsage ? "complete_workstream" : "review_artifacts");
      expect(await readFile(promptLog, "utf8")).toBe(prompt);
      if (reportUsage) {
        const current = await tasks.read();
        nextGoal = {
          schemaVersion: 1,
          kind: "work.goal_completion",
          workstreamId: f.binding.workstreamId,
          workstreamRevision: current.workstream.revision,
          workstreamSnapshotHash: current.workstreamHash,
          ownerAgentId: f.binding.ownerAgentId,
          assignmentReviews: accepted.assignments.map((item) => ({
            assignmentId: item.assignmentId,
            assignmentRevision: item.revision,
            reviewEventId: item.review!.eventId!,
          })),
          resultArtifactHash: assignment.artifactHashes[0]!,
          rationaleArtifactHash: rationale.contentHash,
          completedAt: f.ports.now(),
        };
        for (const defect of ["review", "revision", "pending", "blocked", "unbound"] as const) {
          const staleSource = structuredClone(current);
          const stale = structuredClone({
            assignments: accepted.assignments,
            unboundAssignmentIds: [] as string[],
          });
          if (defect === "review") stale.assignments[0]!.review!.eventId = `evt_${"0".repeat(32)}`;
          if (defect === "revision") staleSource.workstream.revision += 1;
          if (defect === "pending")
            staleSource.workstream.pendingApprovals = [
              {
                approvalId: `wapr_${"a".repeat(16)}`,
                kind: "deployment",
                summary: "Unresolved deployment.",
                bindingHash: nextGoal.resultArtifactHash,
                blocking: true,
              },
            ];
          if (defect === "blocked") staleSource.workstream.blockers = ["Unresolved acceptance."];
          if (defect === "unbound") stale.unboundAssignmentIds = [f.assignment.assignmentId];
          await expect(
            assertCanonicalGoalCompletionBasis({
              source: staleSource,
              observed: stale,
              effect: nextGoal,
              artifacts: storage.artifacts,
            }),
            defect,
          ).rejects.toThrow("unresolved or changed");
        }
        await storage.artifacts.put(canonicalJson(nextGoal));
        const completion = await runtime.runCycle();
        expect(completion.disposition, JSON.stringify({ completion, attention: f.attention })).toBe(
          "effect_confirmed",
        );
        const finished = await tasks.readSnapshot();
        expect(finished.workstreamStatus).toBe("completed");
        const reopened = await openProjectStorage(f.root);
        try {
          expect(await inspectGoalCompletion(reopened, goalPlan!, nextGoal)).toMatchObject({
            status: "confirmed",
            eventIds: [expect.any(String)],
          });
          expect(
            reopened.events
              .list({ limit: 1000 })
              .filter(
                (event) =>
                  event.type === "workstream.snapshot.recorded" &&
                  event.payload.status === "completed",
              ),
          ).toHaveLength(1);
        } finally {
          await reopened.close();
        }
        expect(finished.delivery).toBe("not_attempted");
        expect(
          projectOutcomeSupervision({
            snapshot: finished,
            now: f.ports.now(),
            maximumRecoveryDecisions: 1,
          }).nextAction,
        ).toBe("publish_result");
        const content = new TextDecoder().decode(
          await storage.artifacts.get(`lervo-cas://sha256/${nextGoal.resultArtifactHash.slice(7)}`),
        );
        let evaluations = 0;
        const candidate = await createVerifiedConversationControlReply({
          artifactStore: storage.artifacts,
          writingContract: resultWritingContract,
          content,
          semanticEvaluator: {
            evaluate: async (request) => {
              evaluations++;
              return {
                evaluator: { kind: "model", evaluatorId: "test.owner-publication" },
                checks: request.checks.map((check) => ({
                  checkId: check.checkId,
                  status: "passed" as const,
                  violationCount: 0,
                })),
              };
            },
          },
          now: () => new Date(f.ports.now()),
        });
        const outboundContent = {
          schemaVersion: 1 as const,
          ...origin,
          content: candidate.content,
          publicationPermit: candidate.publicationPermit,
          automationDepth: 1,
          createdAt: f.ports.now(),
        };
        const outbound = {
          ...outboundContent,
          outboundId: calculateConversationOutboundId(outboundContent),
        };
        const completionReceipt = await inspectGoalCompletion(storage, goalPlan!, nextGoal);
        if (completionReceipt.status !== "confirmed")
          throw new Error("Missing completion receipt.");
        nextDelivery = {
          schemaVersion: 1,
          kind: "work.result_delivery",
          workstreamId: f.binding.workstreamId,
          ownerAgentId: f.binding.ownerAgentId,
          completionPlanHash: goalPlan!.effectHash,
          completionEventId: completionReceipt.eventIds[0]!,
          resultArtifactHash: nextGoal.resultArtifactHash,
          candidateArtifactHash: (await storage.artifacts.put(canonicalJson(candidate)))
            .contentHash,
          outboundArtifactHash: (await storage.artifacts.put(canonicalJson(outbound))).contentHash,
          rationaleArtifactHash: rationale.contentHash,
        };
        nextDelivery.completionPlanHash = (
          await storage.artifacts.put(canonicalJson(goalPlan))
        ).contentHash;
        await storage.artifacts.put(canonicalJson(nextDelivery));
        expect((await runtime.runCycle()).disposition, JSON.stringify(f.attention)).toBe(
          "effect_confirmed",
        );
        expect(sent).toHaveLength(0);
        expect((await tasks.readSnapshot()).delivery).toBe("pending");
        await runtime.runCycle();
        expect(sent).toHaveLength(1);
        expect((await tasks.readSnapshot()).workstreamStatus).toBe("completed");
        await runtime.close();
        runtime = await openRuntime();
        publicationClockOffset += 5100;
        await runtime.runCycle();
        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual(sent[0]);
        expect((await tasks.readSnapshot()).delivery).toBe("delivered");
        await runtime.runCycle();
        expect(sent).toHaveLength(2);
        expect(evaluations).toBe(1);
        expect(await readFile(promptLog, "utf8")).toBe(prompt);
      }
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  120_000,
);
