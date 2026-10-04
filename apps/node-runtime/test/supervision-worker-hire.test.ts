import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { listAgents, registerAgent } from "@lervo/agent-workforce";
import { resolveRoleContract } from "@lervo/roles";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, supervisedWorkerHireFields } from "@lervo/work-controller";
import type { OperatingActionPlanV1, SupervisedWorkerHireV1 } from "@lervo/application-contract";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { responsibility } from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { SupervisionWorkerHireEffects } from "../src/supervision-worker-hire-effects.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { projectOrganization } from "../src/agent-organization-event-mutation.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["gap", "available", "fence_loss"])(
  "hires one scoped named child only for an observed gap (existing staff: %s)",
  async (scenario) => {
    const existingStaff = scenario === "available";
    if (scenario === "fence_loss") {
      const execute = SupervisionWorkerHireEffects.prototype.execute;
      vi.spyOn(SupervisionWorkerHireEffects.prototype, "execute").mockImplementation(function (
        this: SupervisionWorkerHireEffects,
        plan,
        session,
      ) {
        return execute.call(this, plan, {
          ...session,
          commit: () => {
            throw new Error("fixture_owner_fence_lost");
          },
        });
      });
    }
    const f = await supervisionFixture(
      roots,
      undefined,
      "developer",
      ["hire_worker"],
      ["developer", "writer"],
    );
    const login = await createLoginFixture(roots);
    if (existingStaff)
      await registerAgent({
        repositoryRoot: f.root,
        roleId: "writer",
        provider: "codex",
        responsibilityPaths: ["src"],
        parentAgentId: f.owner.agentId,
      });
    const storage = await openProjectStorage(f.root);
    const source = new SupervisionTaskSource(storage, f.binding, f.ports.now);
    const role = await resolveRoleContract(f.root, "writer");
    const rationale = await storage.artifacts.put(
      canonicalJson(
        "A writer is needed for the bounded task. Reuse existing qualified staff when available.",
      ),
    );
    const effect: SupervisedWorkerHireV1 = {
      schemaVersion: 1,
      kind: "work.worker_hire",
      displayName: "Mira",
      requirement: {
        ...responsibility(),
        assignmentId: `asn_${"0".repeat(24)}`,
        assignmentRevision: 2,
        executorAgentId: f.owner.agentId,
        reviewerAgentId: f.owner.agentId,
        roleId: "writer",
        roleVersion: role.version,
        roleContractHash: role.contractHash,
        requiredCapabilities: ["filesystem.read"],
        expectedPaths: ["src"],
        verificationSuiteIds: ["role.writing.artifact"],
        startDeadline: new Date(Date.now() + 60_000).toISOString(),
        progressDeadline: new Date(Date.now() + 120_000).toISOString(),
        completionDeadline: new Date(Date.now() + 600_000).toISOString(),
        predecessorBindingHash: null,
      },
      provider: "codex",
      expectedAgentsHash: operatingContractHash(await listAgents(f.root)),
      rationaleArtifactHash: rationale.contentHash,
    };
    await storage.artifacts.put(canonicalJson(effect));
    const readiness = {
      providerExecutables: { codex: login.executable },
      providerLoginContexts: { codex: login.context },
      verificationTools: {},
    };
    let action: OperatingActionPlanV1 | undefined;
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      runtimeReadiness: readiness,
      ports: {
        now: f.ports.now,
        recordAttention: f.ports.recordAttention,
        propose: async (report) =>
          (action = {
            ...(await f.ports.propose(report))!,
            ...supervisedWorkerHireFields(effect),
            graphHash: (await source.read()).graph.graphHash,
          }),
        execute: async () => {
          throw new Error("The fixture cannot execute a hire.");
        },
        inspectEffect: async () => ({ status: "uncertain" }),
      },
    });
    try {
      if (existingStaff) {
        await expect(runtime.runCycle()).rejects.toThrow(/Existing available/iu);
        expect((await listAgents(f.root)).filter((agent) => agent.displayName === "Mira")).toEqual(
          [],
        );
        return;
      }
      const cycle = await runtime.runCycle();
      if (scenario === "fence_loss") {
        expect(cycle.disposition).toBe("uncertain");
        expect(await listAgents(f.root)).toHaveLength(1);
        expect(projectOrganization(storage).memberships).toHaveLength(1);
        expect(
          await new SupervisionWorkerHireEffects(f.root, f.binding, readiness, f.ports.now).inspect(
            action!,
          ),
        ).toMatchObject({ status: "not_started" });
        return;
      }
      expect(cycle.disposition, JSON.stringify({ cycle, attention: f.attention })).toBe(
        "effect_confirmed",
      );
      const hired = (await listAgents(f.root)).find((agent) => agent.displayName === "Mira")!;
      expect(hired).toMatchObject({
        parentAgentId: f.owner.agentId,
        responsibilityPaths: ["src"],
        roleId: "writer",
        status: "active",
        revision: 1,
      });
      expect(
        projectOrganization(storage).memberships.find((item) => item.agentId === hired.agentId),
      ).toMatchObject({
        teamId: f.mandate.teamIds[0],
        roleContractHash: role.contractHash,
        status: "active",
      });
      await runtime.close();
      expect(
        await new SupervisionWorkerHireEffects(f.root, f.binding, readiness, f.ports.now).inspect(
          action!,
        ),
      ).toMatchObject({ status: "confirmed", eventIds: [expect.any(String), expect.any(String)] });
      expect(await listAgents(f.root)).toHaveLength(2);
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  120_000,
);
