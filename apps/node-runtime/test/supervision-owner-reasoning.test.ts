import { applyWorkspaceProvision } from "@lervo/orchestrator";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { SupervisionWorkspaceEffects } from "../src/supervision-workspace-effects.js";
import { readSupervisionWorkspacePlan } from "../src/supervision-workspace-plan.js";
import { execFile } from "node:child_process";
import { inspect, promisify } from "node:util";
import { readFile, writeFile, rm, mkdtemp, realpath, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
  loadRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import { operatingContractHash, supervisedOwnerReasoningFields } from "@lervo/work-controller";
import type {
  OperatingActionPlanV1,
  SupervisedOwnerReasoningV1,
} from "@lervo/application-contract";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { createOwnerReasoningContext } from "../src/supervision-reasoning-context.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { inspectOwnerReasoning } from "../src/supervision-reasoning-receipt.js";
import { observeSupervisionTaskResources } from "../src/supervision-task-resources.js";
import {
  listAssignments,
  listWorkspaces,
  readWorkspace,
  updateWorkspace,
} from "@lervo/agent-workforce";
import { SupervisionOwnerReasoningEffects } from "../src/supervision-reasoning-effects.js";
import { readReusableOwnerDecision } from "../src/supervision-reasoning-history.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { NodeSupervisionStore } from "../src/supervision-store.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([
  "normal",
  "lost_receipt",
  "expired_lost_receipt",
  "legacy_expired_receipt",
  "dirty_legacy_receipt",
  "expired_absent",
  "expired_path",
  "unexpired_absent",
])(
  "runs isolated native owner planning and recovers exact workspace preparation (%s)",
  async (scenario) => {
    const loseWorkspaceReceipt = scenario.includes("receipt");
    const legacyReceipt = scenario.includes("legacy");
    let clockOffset = 0;
    if (loseWorkspaceReceipt)
      vi.spyOn(SupervisionWorkspaceEffects.prototype, "execute").mockImplementationOnce(
        async function (this: SupervisionWorkspaceEffects, plan) {
          const fixtureStorage = await openProjectStorage(currentFixtureRoot!);
          try {
            const basis = await readSupervisionWorkspacePlan(fixtureStorage, plan);
            await applyWorkspaceProvision({
              plan: basis.provision,
              host: new GitWorkspaceHostAdapter(),
            });
            if (legacyReceipt) {
              const stored = (await readWorkspace(
                currentFixtureRoot!,
                basis.provision.workspace.workspaceId,
              ))!;
              await updateWorkspace({
                repositoryRoot: currentFixtureRoot!,
                workspaceId: stored.workspace.workspaceId,
                expectedContentHash: stored.contentHash,
                expectedRevision: stored.workspace.revision,
                expectedGeneration: stored.workspace.generation,
                nextState: "recovery_required",
                recoveryReason: "host_effect_uncertain",
                reasonCode: "host_effect_uncertain",
                occurredAt: new Date().toISOString(),
                eventId: basis.provision.recoveryEventId,
              });
            }
            if (scenario === "dirty_legacy_receipt")
              await writeFile(
                resolve(basis.provision.workspacePath, "unobserved.txt"),
                "Retain these bytes.\n",
              );
            if (scenario.includes("expired"))
              clockOffset = Date.parse(plan.deadline) - Date.now() + 1;
            throw new Error("fixture_process_lost_after_ready");
          } finally {
            await fixtureStorage.close();
          }
        },
      );
    let currentFixtureRoot: string | undefined;
    let invocationError: unknown;
    const executeOwner = SupervisionOwnerReasoningEffects.prototype.execute;
    vi.spyOn(SupervisionOwnerReasoningEffects.prototype, "execute").mockImplementation(
      async function (this: SupervisionOwnerReasoningEffects, ...args) {
        try {
          return await executeOwner.apply(this, args);
        } catch (error) {
          invocationError = error;
          throw error;
        }
      },
    );
    const login = await createLoginFixture(roots);
    const f = await supervisionFixture(
      roots,
      async (root) => {
        await writeFile(
          resolve(root, "AGENTS.md"),
          "Preserve the goal and inspect current evidence before proposing a change.\n",
        );
        const policy = await loadRepositoryKnowledgePolicy(root);
        policy.normalization = { exclude: ["AGENTS.md"] };
        await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: root }),
          new Date(),
          () => undefined,
        );
        const execute = promisify(execFile);
        for (const args of [
          ["init"],
          ["config", "user.name", "Lervo Test"],
          ["config", "user.email", "test@example.invalid"],
          ["add", "AGENTS.md"],
          ["commit", "-m", "fixture"],
        ])
          await execute("git", ["-C", root, ...args]);
      },
      "developer",
      ["allocate_existing", "execute_as_owner"],
    );
    currentFixtureRoot = f.root;
    const promptLog = resolve(login.context.homeDirectory, "owner-prompt.log");
    const startLog = resolve(login.context.homeDirectory, "owner-start.log");
    const loginScript = (await readFile(login.executable, "utf8")).replace(
      "const args=",
      "function inspectLogin(){\nconst args=",
    );
    let script = (
      await readFile(
        resolve("scripts/distribution/fixtures/installed-capability-codex.mjs"),
        "utf8",
      )
    ).replace(/^#![^\n]*\n/u, "");
    script = script.replace(
      '  if (message.method === "thread/start") {',
      `  if (message.method === "thread/start") {\n    await appendFile(${JSON.stringify(startLog)}, JSON.stringify(message.params)+"\\n");`,
    );
    script = script.replace(
      "    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;",
      `    await appendFile(${JSON.stringify(promptLog)}, instructions+"\\n");
    send({method: "thread/tokenUsage/updated", params: {threadId, turnId, tokenUsage: {total: {inputTokens: 40, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0, totalTokens: 50}, modelContextWindow: 100000}}});
    completeTurn(JSON.stringify({schemaVersion: 1, operation: "allocate_existing", rationale: "Reuse the available qualified owner.", details: JSON.stringify({roleId: "developer", taskPurpose: "Inspect the bounded repository setup.", deliverables: ["A verified setup report."], acceptanceCriteria: ["Report whether the setup preserves existing behavior."], decisionLatitude: ["Inspect current repository evidence."], expectedPaths: ["src"], requiredCapabilities: ["filesystem.read"], verificationSuiteIds: ["role.development.artifact"], completionSeconds: 600})}));
    return;
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;`,
    );
    await writeFile(
      login.executable,
      `${loginScript}\n}\nif(process.argv[2]!=="app-server")inspectLogin();\n${script}`,
    );
    const storage = await openProjectStorage(f.root);
    const tasks = new SupervisionTaskSource(storage, f.binding, f.ports.now);
    let action: OperatingActionPlanV1 | undefined;
    const fallback = vi.fn(async () => {
      throw new Error("The native owner adapter must own its effect.");
    });
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ownerReasoning: { provider: "codex", reservedTokens: 100 },
      runtimeReadiness: {
        providerExecutables: { codex: login.executable },
        providerLoginContexts: { codex: login.context },
        verificationTools: {},
      },
      ports: {
        now: f.ports.now,
        recordAttention: f.ports.recordAttention,
        inspectEffect: fallback,
        execute: fallback,
        propose: async (report) => {
          const source = await tasks.read();
          const context = await createOwnerReasoningContext({
            storage,
            binding: f.binding,
            source,
            report,
            expectedPaths: ["src"],
            now: f.ports.now,
          });
          const effect: SupervisedOwnerReasoningV1 = {
            schemaVersion: 1,
            kind: "work.owner_reasoning",
            basisHash: context.context.basisHash,
            contextArtifactHash: context.artifact.contentHash,
            roleId: f.owner.roleId,
            roleVersion: f.owner.roleVersion,
            roleContractHash: f.owner.roleContractHash,
            provider: "codex",
            requestedModel: null,
            reservedTokens: f.mandate.maximumAttemptTokens,
            attemptNumber: 1,
            deadline: new Date(Date.now() + 120_000).toISOString(),
          };
          await storage.artifacts.put(canonicalJson(effect));
          const rationale = await storage.artifacts.put(
            canonicalJson(
              "Read current goal and staff evidence before selecting an operating action.",
            ),
          );
          action = {
            schemaVersion: 1,
            ...f.binding,
            projectId: f.owner.projectId,
            teamId: f.mandate.teamIds[0]!,
            graphHash: source.graph.graphHash,
            sourceRevisionDigest: report.sourceRevisionDigest,
            causationEventIds: report.causationEventIds,
            rationaleArtifactHash: rationale.contentHash,
            ...supervisedOwnerReasoningFields(effect),
          };
          return action;
        },
      },
    });
    try {
      const result = await runtime.runCycle();
      expect(result.disposition, inspect(invocationError, { depth: 8 })).toBe("effect_confirmed");
      expect(fallback).not.toHaveBeenCalled();
      expect(await inspectOwnerReasoning(storage, action!)).toMatchObject({ status: "confirmed" });
      const source = await tasks.read();
      const basis = await canonicalOwnerReasoningFacts(storage, f.binding, source, f.ports.now);
      const reused = await readReusableOwnerDecision({
        storage,
        binding: f.binding,
        source,
        basisHash: basis.basisHash,
        report: result.report!,
        now: f.ports.now,
      });
      expect(reused).toMatchObject({
        reason: "available",
        decision: { operation: "allocate_existing" },
        history: [{ effect: { attemptNumber: 1 } }],
      });
      expect(
        await readReusableOwnerDecision({
          storage,
          binding: { ...f.binding, mandateHash: operatingContractHash("successor mandate") },
          source,
          basisHash: basis.basisHash,
          report: result.report!,
          now: f.ports.now,
        }),
      ).toMatchObject({ history: [], decision: null, reason: "no_current_reasoning_result" });
      expect(source.execution.attempts).toEqual([]);
      expect(source.workstreamResources.groups).toMatchObject([
        { completeness: "complete", totalTokens: 50 },
      ]);
      expect(
        await observeSupervisionTaskResources({
          source,
          artifacts: storage.artifacts,
          events: storage.events,
          plan: action!,
        }),
      ).toMatchObject({
        observedAggregateTokens: 50,
        reservedAggregateTokens: 0,
        activeAttempts: 0,
      });
      const start = JSON.parse((await readFile(startLog, "utf8")).trim());
      expect(start.sandbox).toBe("read-only");
      const prompts = await readFile(promptLog, "utf8");
      expect(prompts).toContain("Preserve the goal and inspect current evidence");
      expect(prompts).toContain(f.owner.agentId);
      expect(await readFile(resolve(f.root, "AGENTS.md"), "utf8")).toBe(
        "Preserve the goal and inspect current evidence before proposing a change.\n",
      );
      expect(operatingContractHash(source.assignments)).toBe(operatingContractHash([]));
      await runtime.close();
      const workspaceParent = await realpath(
        await mkdtemp(resolve(tmpdir(), "lervo-owner-workspaces-")),
      );
      roots.push(workspaceParent);
      const baseCommit = (
        await promisify(execFile)("git", ["-C", f.root, "rev-parse", "HEAD"])
      ).stdout.trim();
      const openNative = () =>
        openNodeOutcomeSupervisionRuntime({
          repositoryRoot: f.root,
          binding: f.binding,
          ownerReasoning: { provider: "codex", reservedTokens: 100 },
          runtimeReadiness: {
            providerExecutables: { codex: login.executable },
            providerLoginContexts: { codex: login.context },
            verificationTools: {},
            workerWorkspace: {
              parentDirectory: workspaceParent,
              baseCommit,
              integrationTargetDigest: operatingContractHash("fixture"),
            },
          },
          ports: {
            now: () => new Date(Date.now() + clockOffset).toISOString(),
            recordAttention: f.ports.recordAttention,
          },
        });
      let native = await openNative();
      try {
        expect((await native.runCycle()).disposition).toBe("effect_confirmed");
        expect(await listAssignments(f.root)).toHaveLength(1);
        expect((await native.runCycle()).disposition).toBe("effect_confirmed");
        expect((await listAssignments(f.root))[0]).toMatchObject({
          status: "leased",
          assigneeAgentId: f.owner.agentId,
          revision: 2,
        });
        if (["expired_absent", "expired_path", "unexpired_absent"].includes(scenario)) {
          vi.spyOn(SupervisionWorkspaceEffects.prototype, "assertReady").mockImplementationOnce(
            async (plan) => {
              if (scenario !== "unexpired_absent")
                clockOffset = Date.parse(plan.deadline) - Date.now() + 1;
              if (scenario === "expired_path") {
                const basis = await readSupervisionWorkspacePlan(storage, plan);
                await mkdir(basis.provision.workspacePath);
              }
              throw new Error("fixture_interrupted_before_host_start");
            },
          );
          await expect(native.runCycle()).rejects.toThrow("fixture_interrupted_before_host_start");
          await native.close();
          native = await openNative();
          const recovered = await native.runCycle();
          expect(recovered.disposition).toBe(
            scenario === "expired_absent" ? "changed" : "uncertain",
          );
          expect(await listWorkspaces(f.root)).toEqual([]);
          expect((await listAssignments(f.root))[0]).toMatchObject({
            status: "leased",
            revision: 2,
          });
          await native.close();
          const store = await NodeSupervisionStore.open({
            repositoryRoot: f.root,
            binding: f.binding,
            now: () => new Date(Date.now() + clockOffset).toISOString(),
          });
          try {
            const pending = await store.withOwner((session) => session.findPendingPlan());
            if (scenario === "expired_absent") expect(pending).toBeNull();
            else expect(pending?.effectContract).toBe("work.workspace_preparation.v1");
          } finally {
            await store.close();
          }
          expect((await readFile(startLog, "utf8")).trim().split("\n")).toHaveLength(1);
          return;
        }
        let prepared = await native.runCycle();
        if (loseWorkspaceReceipt) {
          expect(prepared.disposition).toBe("uncertain");
          await native.close();
          native = await openNative();
          prepared = await native.runCycle();
        }
        if (scenario === "dirty_legacy_receipt") {
          expect(prepared.disposition).toBe("uncertain");
          expect(
            await readFile(
              resolve((await listWorkspaces(f.root))[0]!.ownerWorkspacePath!, "unobserved.txt"),
              "utf8",
            ),
          ).toBe("Retain these bytes.\n");
          expect((await readFile(startLog, "utf8")).trim().split("\n")).toHaveLength(1);
          return;
        }
        expect(prepared.disposition, JSON.stringify(prepared)).toBe("effect_confirmed");
        expect(await listWorkspaces(f.root)).toMatchObject([
          {
            state: legacyReceipt ? "recovery_required" : "ready",
            revision: legacyReceipt ? 3 : 2,
            agentId: f.owner.agentId,
          },
        ]);
        const workspace = (await listWorkspaces(f.root))[0]!;
        expect(
          await readFile(resolve(workspace.ownerWorkspacePath!, "AGENTS.md"), "utf8"),
        ).toContain("Preserve the goal");
        expect((await readFile(startLog, "utf8")).trim().split("\n")).toHaveLength(1);
      } finally {
        await native.close();
      }
      await writeFile(
        resolve(f.root, "AGENTS.md"),
        "The current source policy changed after owner reasoning.\n",
      );
      await expect(
        readReusableOwnerDecision({
          storage,
          binding: f.binding,
          source,
          basisHash: basis.basisHash,
          report: result.report!,
          now: f.ports.now,
        }),
      ).resolves.toMatchObject({ decision: null, reason: "reasoning_source_changed" });
      expect((await readFile(startLog, "utf8")).trim().split("\n")).toHaveLength(1);
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  180_000,
);
