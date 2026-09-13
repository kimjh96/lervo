import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { createWorkstreamUpdatePlan } from "@lervo/repository-knowledge";
import { runCli } from "../../cli/src/main.js";
import { operatingContractHash } from "@lervo/work-controller";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { materializeNativeOwnerProposal } from "../src/supervision-native-plans.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("records a concrete native escalation once, waits across restart, and wakes for a changed canonical goal", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["escalate"]);
  const storage = await openProjectStorage(f.root);
  const tasks = new SupervisionTaskSource(storage, f.binding, f.ports.now);
  let proposals = 0;
  const open = () =>
    openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: {
        now: f.ports.now,
        recordAttention: f.ports.recordAttention,
        propose: async (report) => {
          proposals++;
          const source = await tasks.read();
          const { facts, basisHash } = await canonicalOwnerReasoningFacts(
            storage,
            f.binding,
            source,
            f.ports.now,
          );
          const base: OperatingActionPlanV1 = {
            schemaVersion: 1,
            ...f.binding,
            projectId: f.owner.projectId,
            teamId: f.mandate.teamIds[0]!,
            sourceRevisionDigest: report.sourceRevisionDigest,
            graphHash: source.graph.graphHash,
            causationEventIds: report.causationEventIds,
            actionKind: "execute_as_owner",
            effectContract: "work.owner_reasoning.v1",
            effectHash: operatingContractHash(null),
            rationaleArtifactHash: operatingContractHash(null),
            responsibilityArtifactHash: basisHash,
            roleId: f.owner.roleId,
            provider: "codex",
            requiredCapabilities: [],
            expectedPaths: [],
            addedWorkers: 0,
            addedAssignments: 0,
            concurrentAttempts: 0,
            attemptNumber: 1,
            reservedTokens: 1,
            deadline: new Date(Date.now() + 60_000).toISOString(),
          };
          return materializeNativeOwnerProposal({
            storage,
            facts,
            base,
            decision: {
              schemaVersion: 1,
              operation: "escalate",
              details: JSON.stringify({ reasonCode: "source_policy_decision_required" }),
              rationale: "The goal needs an explicit source policy before research can start.",
            },
            reasoningPlanHash: operatingContractHash("fixture reasoning plan"),
            resultArtifactHash: operatingContractHash("fixture reasoning result"),
            readiness: { providerExecutables: {}, verificationTools: {} },
            now: f.ports.now,
          });
        },
        execute: async () => {
          throw new Error("No custom escalation effect.");
        },
        inspectEffect: async () => {
          throw new Error("No custom escalation receipt.");
        },
      },
    });
  try {
    const runtime = await open();
    try {
      await runtime.runCycle();
      expect(f.attention).toEqual([]);
      expect((await tasks.readSnapshot()).attentionPending).toBe(true);
      expect((await runtime.runCycle()).report?.reasonCode).toBe("owner_attention_pending");
      expect(proposals).toBe(1);
    } finally {
      await runtime.close();
    }
    const restarted = await open();
    try {
      expect((await restarted.runCycle()).disposition).toBe("idle");
      expect(proposals).toBe(1);
      const source = await tasks.read();
      const plan = await createWorkstreamUpdatePlan({
        repositoryRoot: f.root,
        projectId: f.owner.projectId,
        snapshot: {
          ...source.workstream,
          revision: source.workstream.revision + 1,
          objective: "Research only the repository-authored source policy.",
          updatedAt: f.ports.now(),
        },
      });
      const errors: string[] = [];
      expect(
        await runCli(
          ["workstream", "update", "--stdin", "--apply", plan.planId, "--actor", "user", "--json"],
          {
            cwd: f.root,
            stdin: async () => JSON.stringify(plan.snapshot),
            stdout: () => undefined,
            stderr: (text) => errors.push(text),
          },
        ),
        errors.join("\n"),
      ).toBe(0);
      expect((await tasks.readSnapshot()).attentionPending).toBe(false);
      await restarted.runCycle();
      expect(proposals).toBe(2);
      expect(
        storage.events
          .list()
          .filter((event) => event.type === "work.supervision.escalation.recorded"),
      ).toHaveLength(2);
      expect(storage.events.list().some((event) => event.type === "adapter.started")).toBe(false);
    } finally {
      await restarted.close();
    }
  } finally {
    await storage.close();
  }
}, 60_000);
