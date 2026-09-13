import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerAgent } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  loadRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionOwnerReasoningEffects } from "../src/supervision-reasoning-effects.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([
  "absent",
  "reserved",
  "lost_fence",
  "unchanged",
  "deadline_absent",
  "deadline_reserved",
  "deadline_lost_fence",
])(
  "supersedes a stale owner plan only with fenced invocation absence (%s)",
  async (scenario) => {
    const expired = scenario.startsWith("deadline_");
    const absent = scenario === "absent" || scenario === "deadline_absent";
    let clockOffset = 0;
    const now = () => new Date(Date.now() + clockOffset).toISOString();
    const login = await createLoginFixture(roots);
    const f = await supervisionFixture(
      roots,
      async (root) => {
        await writeFile(
          resolve(root, "AGENTS.md"),
          "Inspect canonical evidence before allocating work.\n",
        );
        const policy = await loadRepositoryKnowledgePolicy(root);
        policy.normalization = { exclude: ["AGENTS.md"] };
        await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), JSON.stringify(policy));
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: root }),
          new Date(),
          () => undefined,
        );
      },
      "developer",
      ["allocate_existing", "execute_as_owner"],
    );
    const storage = await openProjectStorage(f.root);
    const execute = vi
      .spyOn(SupervisionOwnerReasoningEffects.prototype, "execute")
      .mockImplementation(async (plan, session) => {
        if (scenario.endsWith("reserved")) {
          const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
          session.commit(() =>
            storage.events.append({
              eventId: `evt_${operatingContractHash({ kind: "managed.execution.reserved", ...identity }).slice(7, 39)}`,
              projectId: plan.projectId,
              ...identity,
              schemaVersion: 3,
              type: "managed.execution.reserved",
              occurredAt: f.ports.now(),
              actor: { kind: "system" },
              policyVersion: operatingContractHash({ contract: plan.effectContract }),
              payload: { executionKey: operatingContractHash(plan), requestHash: plan.effectHash },
            }),
          );
        }
        throw new Error("fixture_interrupted_before_provider_start");
      });
    const open = () =>
      openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ownerReasoning: { provider: "codex", reservedTokens: 100 },
        runtimeReadiness: {
          providerExecutables: { codex: login.executable },
          providerLoginContexts: { codex: login.context },
          verificationTools: {},
        },
        ports: { now, recordAttention: f.ports.recordAttention },
      });
    let runtime = await open();
    try {
      expect((await runtime.runCycle()).disposition).toBe("uncertain");
      expect(execute).toHaveBeenCalledTimes(1);
      await runtime.close();
      if (expired) clockOffset = Date.parse(execute.mock.calls[0]![0].deadline) - Date.now() + 1;
      if (scenario !== "unchanged" && !expired)
        await registerAgent({
          repositoryRoot: f.root,
          roleId: "developer",
          provider: "codex",
          responsibilityPaths: ["src"],
          parentAgentId: f.owner.agentId,
        });
      runtime = await open();
      if (scenario.endsWith("lost_fence")) {
        const supersede = SupervisionOwnerReasoningEffects.prototype.supersede;
        vi.spyOn(SupervisionOwnerReasoningEffects.prototype, "supersede").mockImplementation(
          function (this: SupervisionOwnerReasoningEffects, plan, digest, session) {
            return supersede.call(this, plan, digest, {
              ...session,
              commit: () => {
                throw new Error("fixture_lost_fence");
              },
            });
          },
        );
        await expect(runtime.runCycle()).rejects.toThrow("fixture_lost_fence");
      } else {
        expect((await runtime.runCycle()).disposition, JSON.stringify(f.attention)).toBe(
          absent ? "changed" : "uncertain",
        );
      }
      const source = await new SupervisionTaskSource(storage, f.binding, now).read();
      const supersessions = source.events.filter(
        (event) => event.type === "work.supervision.decision.superseded",
      );
      expect(supersessions).toHaveLength(absent ? 1 : 0);
      expect(execute).toHaveBeenCalledTimes(1);
      if (absent) {
        await runtime.close();
        runtime = await open();
        expect((await runtime.runCycle()).disposition).toBe("uncertain");
        expect(execute).toHaveBeenCalledTimes(2);
        expect(execute.mock.calls[1]![0].effectHash).not.toBe(execute.mock.calls[0]![0].effectHash);
        const latest = await new SupervisionTaskSource(storage, f.binding, now).read();
        expect(latest.events.filter((event) => event.type === "adapter.started")).toHaveLength(0);
      }
    } finally {
      await runtime.close();
      await storage.close();
    }
  },
  60_000,
);
