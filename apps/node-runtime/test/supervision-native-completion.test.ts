import type {
  OperatingActionPlanV1,
  SupervisedResultDeliveryV2,
} from "@lervo/application-contract";
import type { ConversationReplyCandidate } from "@lervo/interaction";
import { assertNativePublicationJudgement } from "../src/supervision-publication-judgement.js";
import { readSupervisionJsonArtifact } from "../src/supervision-artifact-json.js";
import type { ConversationOutboundMessage } from "@lervo/schemas";
import type { NodeSupervisionResultDeliveryConfiguration } from "../src/supervision-result-delivery.js";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { listAssignments, listWorkspaces } from "@lervo/agent-workforce";
import {
  loadRepositoryKnowledgePolicy,
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([
  "normal",
  "late_completion",
  "late_recovery",
  "recovery",
  "failed_writing",
  "writing_rework",
  "rework",
  "rework_receipt_failure",
  "publication_retry",
])(
  "completes native supervised work with exact semantic evidence (%s)",
  async (scenario) => {
    const completedRework = scenario.startsWith("rework");
    const writingRework = scenario === "writing_rework";
    const rework = completedRework || writingRework;
    if (
      scenario === "recovery" ||
      scenario === "late_recovery" ||
      scenario === "rework_receipt_failure"
    ) {
      const append = SQLiteEventStore.prototype.append;
      let failOnce = true;
      vi.spyOn(SQLiteEventStore.prototype, "append").mockImplementation(function (
        this: SQLiteEventStore,
        draft,
      ) {
        if (
          draft.type ===
            (scenario === "recovery" || scenario === "late_recovery"
              ? "assignment.completion.reconciled"
              : "assignment.reopened") &&
          failOnce
        ) {
          failOnce = false;
          throw new Error("fixture_event_failure");
        }
        return append.call(this, draft);
      });
    }
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
      [
        "allocate_existing",
        "dispatch",
        "execute_as_owner",
        "publish_result",
        "request_rework",
        "revise_responsibility",
      ],
      undefined,
      scenario.startsWith("late_") ? 20_000 : undefined,
    );
    const log = resolve(f.login.context.homeDirectory, "native-operations.log");
    const promptLog = resolve(f.login.context.homeDirectory, "worker-prompt.log");
    const login = (await readFile(f.login.executable, "utf8")).replace(
      "const args=",
      "function inspectLogin(){\nconst args=",
    );
    let provider = (
      await readFile(
        resolve("scripts/distribution/fixtures/installed-capability-codex.mjs"),
        "utf8",
      )
    )
      .replace(/^#![^\n]*\n/u, "")
      .replaceAll("src/result.ts", "src/save.ts");
    provider = provider.replace(
      "function completeTurn(content) {",
      `function completeTurn(content) {
    send({method:"thread/tokenUsage/updated",params:{threadId,turnId,tokenUsage:{total:{inputTokens:40,cachedInputTokens:0,outputTokens:10,reasoningOutputTokens:0,totalTokens:50},modelContextWindow:100000}}});`,
    );
    provider = provider.replace(
      "    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;",
      `
    if (instructions.includes("Act as the registered product owner.")) {
      const context = JSON.parse(instructions.slice(instructions.lastIndexOf("\\n\\n") + 2));
      const task = context.facts.tasks.assignments[0];
      let operation, details;
      if (context.trigger.nextAction === "publish_result") {
        operation = "prepare_publication";
        details = {resultContentHash:context.facts.acceptedGoal.resultArtifactHash,writingPolicyId:context.facts.resultWritingContract.writingPolicyId,checks:context.facts.resultWritingContract.verification.semanticChecks.filter(check=>check.required).map(check=>({checkId:check.checkId,status:"passed",violationCount:0}))};
      } else if (task.review?.verdict === "rework") {
        operation="request_rework";
        const before = context.facts.responsibilities[0].binding.responsibility;
        details={assignmentId:task.assignmentId,task:{roleId:before.roleId,taskPurpose:"Recheck and correct the rejected result while preserving the saved value.",deliverables:before.deliverables,acceptanceCriteria:before.acceptanceCriteria,decisionLatitude:before.decisionLatitude,expectedPaths:before.expectedPaths,requiredCapabilities:before.requiredCapabilities,verificationSuiteIds:before.verificationSuiteIds,completionSeconds:600}};
      } else if (task.status === "leased") {
        operation = "prepare_completion";
        details = {assignmentId:task.assignmentId,resultContentHash:task.artifactHashes[0],writingPolicyId:context.facts.writingContract.writingPolicyId,checks:context.facts.writingContract.verification.semanticChecks.filter(check=>check.required).map(check=>({checkId:check.checkId,status:${scenario === "failed_writing" ? '"failed"' : writingRework ? 'context.facts.assignments[0].recovery === undefined ? "failed" : "passed"' : '"passed"'},violationCount:${scenario === "failed_writing" ? "1" : writingRework ? "context.facts.assignments[0].recovery === undefined ? 1 : 0" : "0"}}))};
      } else if (task.review === null) {operation="review_artifacts";details={assignmentId:task.assignmentId,verdict:${completedRework ? 'context.facts.assignments[0].recovery === undefined ? "rework" : "accepted"' : '"accepted"'}};}

      else {operation="complete_workstream";details={result:"The saved value was updated and verified in the assigned workspace. The original repository remains available for integration."};}
      await appendFile(${JSON.stringify(log)}, operation+"\\n");
      completeTurn(JSON.stringify({schemaVersion:1,operation,rationale:"The fixture independently evaluated the exact returned evidence.",details:JSON.stringify(details)})); return;
    }
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;`,
    );
    await writeFile(
      f.login.executable,
      `${login}\n}\nif(process.argv[2]!=="app-server")inspectLogin();\nprocess.env.LERVO_INSTALLED_CAPABILITY_TARGET=process.cwd()+"/src/save.ts";\nprocess.env.LERVO_INSTALLED_CAPABILITY_PROMPT_LOG=${JSON.stringify(promptLog)};\nprocess.env.LERVO_INSTALLED_CAPABILITY_CHANGE_KIND="update";\nprocess.env.LERVO_INSTALLED_CAPABILITY_CONTENT="export const saved = 'verified';\\n";\nprocess.env.LERVO_INSTALLED_CAPABILITY_RESULT="The saved value was updated and verification passed.";\n${provider}`,
    );
    const storage = await openProjectStorage(f.root);
    let clockOffset = 0;
    const now = () => new Date(Date.parse(f.ports.now()) + clockOffset).toISOString();
    const sent: ConversationOutboundMessage[] = [];
    const resultDelivery: NodeSupervisionResultDeliveryConfiguration = {
      origin: {
        sourceEventId: `cve_${"3".repeat(64)}`,
        policyId: `cpp_${"4".repeat(64)}`,
        target: {
          integrationId: "itg_nativepublication",
          projectId: storage.manifest.projectId,
          conversationId: "cnv_nativepublication",
          threadId: null,
        },
        actor: { kind: "agent", participantId: "ptc_nativeowner", roleId: f.owner.roleId },
      },
      adapter: {
        descriptor: {
          schemaVersion: 1,
          integrationId: "itg_nativepublication",
          adapterKind: "discord",
          instanceIdentityHash: `sha256:${"c".repeat(64)}`,
          capabilities: ["messages.send"],
        },
        deliver: async (outbound) => {
          sent.push(structuredClone(outbound));
          if (sent.length === 1) throw new Error("fixture_transport_failure");
          return {
            schemaVersion: 1,
            outboundId: outbound.outboundId,
            integrationId: outbound.target.integrationId,
            deliveryKeyHash: `sha256:${"d".repeat(64)}`,
            deliveredAt: now(),
          };
        },
      },
    };
    const openRuntime = () =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: { now, recordAttention: f.ports.recordAttention },
        ...(scenario === "publication_retry" ? { resultDelivery } : {}),
        ownerReasoning: { provider: "codex", reservedTokens: 100 },
        runtimeReadiness: f.runtimeReadiness,
        managedExecution: {
          nodeExecutable: process.execPath,
          cliBundle: resolve("apps/cli/dist/bin.js"),
        },
      });
    let runtime = await openRuntime();
    try {
      const cycles = [];
      for (let i = 0; i < (writingRework ? 14 : completedRework ? 16 : 7); i++) {
        if (i === 2 && scenario === "failed_writing") {
          expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
          const rejected = await new SupervisionTaskSource(storage, f.binding, now).read();
          expect(
            rejected.events.filter((event) => event.type === "work.supervision.review.recorded"),
          ).toMatchObject([{ payload: { verdict: "rework" } }]);
          expect(await listAssignments(f.root)).toMatchObject([{ status: "leased" }]);
          expect(
            storage.events
              .list({ limit: 1000 })
              .filter((event) => event.type === "assignment.completion.prepared"),
          ).toEqual([]);
          return;
        }
        if (i === 1 && scenario.startsWith("late_")) {
          const remaining = Date.parse(f.assignment.lease!.expiresAt) - Date.now() + 50;
          if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
        }
        let cycle = await runtime.runCycle();
        if (
          (i === 2 && (scenario === "recovery" || scenario === "late_recovery")) ||
          (i === 6 && scenario === "rework_receipt_failure")
        ) {
          expect(cycle.disposition).toBe("uncertain");
          expect(await listAssignments(f.root)).toMatchObject([
            { status: scenario === "rework_receipt_failure" ? "completed" : "leased" },
          ]);
          await runtime.close();
          runtime = await openRuntime();
          cycle = await runtime.runCycle();
        }
        cycles.push(cycle);
        expect(cycle.disposition, JSON.stringify({ cycles, attention: f.attention })).toBe(
          "effect_confirmed",
        );
        if (i === 1 || i === 3 || (rework && i === 6)) {
          await runtime.close();
          runtime = await openRuntime();
        }
      }
      if (scenario === "publication_retry") {
        for (let i = 0; i < 2; i++)
          expect((await runtime.runCycle()).disposition, JSON.stringify(f.attention)).toBe(
            "effect_confirmed",
          );
        const calls = await readFile(log, "utf8");
        const workerPrompts = await readFile(promptLog, "utf8");
        expect(sent).toHaveLength(0);
        await runtime.runCycle();
        expect(sent).toHaveLength(1);
        await runtime.close();
        runtime = await openRuntime();
        clockOffset += 5100;
        await runtime.runCycle();
        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual(sent[0]);
        expect(await readFile(log, "utf8")).toBe(calls);
        expect(await readFile(promptLog, "utf8")).toBe(workerPrompts);
        const state = await new SupervisionTaskSource(storage, f.binding, now).read();
        const queued = state.events.findLast(
          (event) => event.type === "work.supervision.delivery.queued",
        )!;
        const publicationPlan = (await readSupervisionJsonArtifact(
          storage.artifacts,
          String(queued.payload.planHash),
        )) as OperatingActionPlanV1;
        const effect = (await readSupervisionJsonArtifact(
          storage.artifacts,
          publicationPlan.effectHash,
        )) as SupervisedResultDeliveryV2;
        expect(effect.schemaVersion).toBe(2);
        const candidate = (await readSupervisionJsonArtifact(
          storage.artifacts,
          effect.candidateArtifactHash,
        )) as ConversationReplyCandidate;
        const completionPlan = (await readSupervisionJsonArtifact(
          storage.artifacts,
          effect.completionPlanHash,
        )) as OperatingActionPlanV1;
        await expect(
          assertNativePublicationJudgement({
            ...storage,
            completionPlan,
            candidate,
            effect: { ...effect, reasoningResultHash: effect.resultArtifactHash },
          }),
        ).rejects.toThrow(/semantic model result/iu);

        expect(
          (await new SupervisionTaskSource(storage, f.binding, now).read()).events
            .filter((event) => event.type === "work.supervision.delivery.observed")
            .map((event) => event.payload.status),
        ).toEqual(["failed", "delivered"]);
      }
      expect((await readCurrentWorkstreamState(f.root))?.snapshot.status).toBe("completed");
      if (scenario !== "publication_retry") {
        const calls = await readFile(log, "utf8");
        for (let i = 0; i < 2; i++) expect((await runtime.runCycle()).disposition).toBe("idle");
        expect(await readFile(log, "utf8")).toBe(calls);
      }
      expect(await listAssignments(f.root)).toMatchObject([{ status: "completed", lease: null }]);
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
        "prepare_completion",
        ...(writingRework ? ["request_rework", "prepare_completion"] : []),
        "review_artifacts",
        ...(completedRework ? ["request_rework", "prepare_completion", "review_artifacts"] : []),
        "complete_workstream",
        ...(scenario === "publication_retry" ? ["prepare_publication"] : []),
      ]);
      const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
      if (scenario.startsWith("late_")) {
        const decisions = source.events.filter(
          (event) => event.type === "work.supervision.decision.recorded",
        );
        const plans = await Promise.all(
          decisions.map(
            (event) =>
              readSupervisionJsonArtifact(
                storage.artifacts,
                String(event.payload.planArtifactHash),
              ) as Promise<OperatingActionPlanV1>,
          ),
        );
        expect(
          plans.filter((plan) => plan.effectContract === "work.assignment_completion.v3"),
        ).toHaveLength(1);
        expect(source.execution.attempts).toHaveLength(1);
        expect(source.events.filter((event) => event.type === "assignment.reopened")).toHaveLength(
          0,
        );
        expect(
          source.events.filter((event) => event.type === "assignment.lease.renewed"),
        ).toHaveLength(0);
      }
      if (rework) {
        expect(source.execution.attempts).toMatchObject([
          { attemptOrdinal: 1, relationship: "root" },
          { attemptOrdinal: 2, relationship: "retry" },
        ]);
        expect(source.execution.attempts[0]!.workId).toBe(source.execution.attempts[1]!.workId);
        const workspaces = await listWorkspaces(f.root);
        expect(workspaces).toHaveLength(2);
        expect(workspaces.map((item) => item.leaseGeneration).sort()).toEqual([1, 2]);
        expect(new Set(workspaces.map((item) => item.ownerWorkspacePath)).size).toBe(2);
        for (const workspace of workspaces)
          expect(
            await readFile(resolve(workspace.ownerWorkspacePath!, "src/save.ts"), "utf8"),
          ).toContain("verified");
        expect(source.events.filter((event) => event.type === "assignment.reopened")).toHaveLength(
          1,
        );
      }
      expect(source.workstreamResources.groups).toMatchObject([
        {
          completeness: "complete",
          totalTokens: writingRework
            ? 350
            : completedRework
              ? 400
              : scenario === "publication_retry"
                ? 250
                : 200,
        },
      ]);
      expect(
        source.events.filter((event) => event.type === "assignment.completion.prepared"),
      ).toHaveLength(completedRework ? 2 : 1);
      expect(
        source.events.filter((event) => event.type === "assignment.completion.reconciled"),
      ).toHaveLength(completedRework ? 2 : 1);
      expect(await readFile(resolve(f.workspacePath, "src/save.ts"), "utf8")).toContain("verified");
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  180_000,
);
