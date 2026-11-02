import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { createWorkstreamUpdatePlan } from "@lervo/repository-knowledge";
import { runCli } from "../../cli/src/main.js";
import { operatingContractHash, principalEscalationBoundMs } from "@lervo/work-controller";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { materializeNativeOwnerProposal } from "../src/supervision-native-plans.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([
  ["exact", { reasonCode: "source_policy_decision_required" }, "source_policy_decision_required"],
  [
    "explained",
    {
      reasonCode: "four_task_scope_missing",
      neededDecision: "Identify the four intended work items and their deployment scope.",
      observedNextActions: [
        "Diagnose the capacity failure",
        "Activate the economic model",
        "Triage the failing tests",
      ],
    },
    "four_task_scope_missing",
  ],
  [
    "ambiguous",
    { reasonCode: "source_policy_decision_required", recipientProjectId: "prj_other" },
    "owner_proposal_invalid",
  ],
] as const)(
  "records a native escalation once, waits across restart, and wakes for a changed goal (%s)",
  async (_scenario, details, expectedReasonCode) => {
    const f = await supervisionFixture(roots, undefined, "developer", ["escalate"]);
    const storage = await openProjectStorage(f.root);
    const tasks = new SupervisionTaskSource(storage, f.binding, f.ports.now);
    let proposals = 0;
    const open = (now = f.ports.now) =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: {
          now,
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
                details: JSON.stringify(details),
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
        const escalations = storage.events
          .list()
          .filter((event) => event.type === "work.supervision.escalation.recorded");
        expect(escalations).toMatchObject([{ payload: { reasonCode: expectedReasonCode } }]);
        expect(await tasks.readSnapshot()).toMatchObject({
          attentionPending: true,
          attentionPendingSince: escalations[0]!.occurredAt,
        });
        // Owner attention is a notice: the principal proxy decides once the bound passes.
        expect((await runtime.runCycle()).report).toMatchObject({
          reasonCode: "owner_attention_pending",
          nextCheckAt: new Date(
            Date.parse(escalations[0]!.occurredAt) + principalEscalationBoundMs,
          ).toISOString(),
        });
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
            [
              "workstream",
              "update",
              "--stdin",
              "--apply",
              plan.planId,
              "--actor",
              "user",
              "--json",
            ],
            {
              cwd: f.root,
              stdin: async () => JSON.stringify(plan.snapshot),
              stdout: () => undefined,
              stderr: (text) => errors.push(text),
            },
          ),
          errors.join("\n"),
        ).toBe(0);
        expect(await tasks.readSnapshot()).toMatchObject({
          attentionPending: false,
          attentionPendingSince: null,
        });
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
      // Past the bound the pending attention no longer blocks, and the owner is never asked again.
      const proxy = await open(() =>
        new Date(Date.now() + principalEscalationBoundMs).toISOString(),
      );
      try {
        expect((await proxy.runCycle()).disposition).toBe("blocked");
        expect(proposals).toBe(3);
        expect(f.attention.at(-1)).toEqual(["lervo_debt", "principal_scope_exceeded"]);
        expect(
          storage.events
            .list()
            .filter((event) => event.type === "work.supervision.escalation.recorded"),
        ).toHaveLength(2);
      } finally {
        await proxy.close();
      }
    } finally {
      await storage.close();
    }
  },
  60_000,
);
