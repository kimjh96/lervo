import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { materializeSuccessorClaim } from "../src/supervision-recovery-claim.js";
import { execFile } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import {
  createAssignment,
  claimAssignment,
  listAssignments,
  registerAgent,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  loadRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import { operatingContractHash } from "@lervo/work-controller";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { responsibility } from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { recordResponsibilityFixture } from "./supervision-responsibility.fixture.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { materializeNativeOwnerProposal } from "../src/supervision-native-plans.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["expired", "live", "criteria_changed", "criteria_receipt_failure"])(
  "reassigns only unstarted unleased duties using actual qualified staff (%s)",
  async (scenario) => {
    const amendment = scenario.startsWith("criteria_");
    if (scenario === "criteria_receipt_failure") {
      const append = SQLiteEventStore.prototype.append;
      let once = true;
      vi.spyOn(SQLiteEventStore.prototype, "append").mockImplementation(function (
        this: SQLiteEventStore,
        draft,
      ) {
        if (draft.type === "assignment.amended" && once) {
          once = false;
          throw new Error("fixture_receipt_failure");
        }
        return append.call(this, draft);
      });
    }
    const f = await supervisionFixture(
      roots,
      async (root) => {
        await writeFile(
          resolve(root, "AGENTS.md"),
          "Preserve the task scope and record versioned acceptance amendments.\n",
        );
        const policy = await loadRepositoryKnowledgePolicy(root);
        policy.normalization = { exclude: ["AGENTS.md"] };
        await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: root }),
          new Date(),
          () => undefined,
        );
        for (const args of [
          ["init"],
          ["config", "user.name", "Lervo Test"],
          ["config", "user.email", "test@example.invalid"],
          ["add", "AGENTS.md"],
          ["commit", "-m", "fixture"],
        ])
          await promisify(execFile)("git", ["-C", root, ...args]);
      },
      "developer",
      ["allocate_existing", "revise_responsibility"],
    );
    const login = await createLoginFixture(roots);
    const original = responsibility();
    const created = await createAssignment({
      repositoryRoot: f.root,
      workstreamId: f.binding.workstreamId,
      taskType: "implementation",
      roleId: "developer",
      expectedPaths: ["src"],
      acceptanceCriteria: original.acceptanceCriteria,
      verificationSuiteIds: original.verificationSuiteIds,
    });
    const claimed = await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: created.assignmentId,
      agentId: f.owner.agentId,
      sessionId: "ses_previous_duties",
      leaseDurationMs: 5000,
    });
    const task = {
      ...original,
      assignmentId: claimed.assignmentId,
      assignmentRevision: claimed.revision,
      executorAgentId: f.owner.agentId,
      reviewerAgentId: f.owner.agentId,
      roleVersion: f.owner.roleVersion,
      roleContractHash: f.owner.roleContractHash,
      requiredCapabilities: ["filesystem.read"],
      expectedPaths: ["src"],
      startDeadline: new Date(Date.now() + 60000).toISOString(),
      progressDeadline: new Date(Date.now() + 120000).toISOString(),
      completionDeadline: new Date(Date.now() + 1200000).toISOString(),
    };
    await recordResponsibilityFixture({
      ...f,
      responsibility: task,
      workstreamRevision: f.observation.workstreamRevision,
      causationEventIds: f.observation.causationEventIds,
    });
    const child = await registerAgent({
      repositoryRoot: f.root,
      roleId: "developer",
      provider: "codex",
      responsibilityPaths: ["src"],
      parentAgentId: f.owner.agentId,
    });
    const now = () => new Date(Date.now() + (scenario === "live" ? 0 : 6000)).toISOString();
    const storage = await openProjectStorage(f.root);
    const source = new SupervisionTaskSource(storage, f.binding, now);
    const readiness = {
      providerExecutables: { codex: login.executable },
      providerLoginContexts: { codex: login.context },
      verificationTools: {},
    };
    const openRuntime = () =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        runtimeReadiness: readiness,
        ports: {
          now,
          recordAttention: f.ports.recordAttention,
          propose: async (report) => {
            const current = await source.read();
            if (amendment && current.assignments[0]?.amendment !== undefined)
              return materializeSuccessorClaim({
                storage,
                source: current,
                base: { ...(await f.ports.propose(report))!, graphHash: current.graph.graphHash },
                assignmentIds: [task.assignmentId],
                now,
              });
            const facts = await canonicalOwnerReasoningFacts(storage, f.binding, current, now);
            const details = {
              assignmentId: task.assignmentId,
              task: {
                roleId: task.roleId,
                taskPurpose: "Inspect the task with revised bounded duties.",
                deliverables: task.deliverables,
                acceptanceCriteria: amendment
                  ? ["Verify the revised task and preserve its documented evidence"]
                  : task.acceptanceCriteria,
                decisionLatitude: task.decisionLatitude,
                expectedPaths: task.expectedPaths,
                requiredCapabilities: task.requiredCapabilities,
                verificationSuiteIds: task.verificationSuiteIds,
                completionSeconds: 600,
              },
            };
            return materializeNativeOwnerProposal({
              storage,
              facts: facts.facts,
              base: { ...(await f.ports.propose(report))!, graphHash: current.graph.graphHash },
              decision: {
                schemaVersion: 1,
                operation: "revise_responsibility",
                rationale: "Reuse the available qualified child after the old lease expires.",
                details: JSON.stringify(details),
              },
              reasoningPlanHash: operatingContractHash("fixture reasoning"),
              resultArtifactHash: operatingContractHash("fixture decision"),
              readiness,
              now,
            });
          },
          execute: async () => {
            throw new Error("The canonical claim must own this effect.");
          },
          inspectEffect: async () => ({ status: "uncertain" }),
        },
      });
    let runtime = await openRuntime();
    try {
      if (scenario === "live") {
        await expect(runtime.runCycle()).rejects.toThrow(/scope|lease|assignment/iu);
        expect((await listAssignments(f.root))[0]).toEqual(claimed);
        return;
      }
      let cycle = await runtime.runCycle();
      if (scenario === "criteria_receipt_failure") {
        expect(cycle.disposition).toBe("uncertain");
        expect((await listAssignments(f.root))[0]).toEqual(claimed);
        await runtime.close();
        runtime = await openRuntime();
        cycle = await runtime.runCycle();
      }
      expect(cycle.disposition, JSON.stringify(f.attention)).toBe("effect_confirmed");
      if (amendment) {
        const amended = (await listAssignments(f.root))[0]!;
        expect(amended).toMatchObject({
          status: "queued",
          lease: null,
          revision: claimed.revision + 1,
          acceptanceCriteria: ["Verify the revised task and preserve its documented evidence"],
          amendment: {
            predecessorAssignmentHash: operatingContractHash(claimed),
            predecessorResponsibilityHash: operatingContractHash(task),
          },
        });
        await runtime.close();
        runtime = await openRuntime();
        expect((await runtime.runCycle()).disposition, JSON.stringify(f.attention)).toBe(
          "effect_confirmed",
        );
      }
      expect(await listAssignments(f.root)).toMatchObject([
        {
          assignmentId: claimed.assignmentId,
          revision: claimed.revision + (amendment ? 2 : 1),
          assigneeAgentId: child.agentId,
          lease: { generation: 2 },
          acceptanceCriteria: amendment
            ? ["Verify the revised task and preserve its documented evidence"]
            : task.acceptanceCriteria,
        },
      ]);
      const current = await source.read();
      expect(current.responsibilities[0]!.binding?.responsibility).toMatchObject({
        executorAgentId: child.agentId,
        reviewerAgentId: f.owner.agentId,
        predecessorBindingHash: operatingContractHash(task),
      });
      expect(current.execution.attempts).toEqual([]);
      expect(await readFile(resolve(f.root, "AGENTS.md"), "utf8")).toContain("Preserve the task");
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  30000,
);
