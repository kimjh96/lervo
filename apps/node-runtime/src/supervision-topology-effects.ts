import type { AutomaticTopologyEffectV1, OperatingActionPlanV1 } from "@lervo/application-contract";
import { listAgents, listAssignments } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { observeNodeSupervisionAuthority } from "./supervision-authority.js";
import type { NodeSupervisionSession } from "./supervision-session.js";
import type { NodeSupervisionEffectSession } from "./outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { readCanonicalSupervisionTopology } from "./supervision-topology-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { observeSupervisionWorkforce } from "./supervision-workforce-source.js";

/** Composes exact canonical allocation with fenced, rollback-aware workforce materialization. */
export class SupervisionTopologyEffects {
  private readonly binding: NodeSupervisionBinding;
  constructor(
    private readonly root: string,
    binding: NodeSupervisionBinding,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
  }

  async inspect(
    plan: OperatingActionPlanV1,
    session: Pick<NodeSupervisionSession, "inspectTopology">,
  ) {
    const storage = await openProjectStorage(this.root);
    try {
      const effect = (await readSupervisionJsonArtifact(
        storage.artifacts,
        plan.effectHash,
      )) as AutomaticTopologyEffectV1;
      const result = await session.inspectTopology(effect, plan);
      return result.status === "confirmed"
        ? { status: "confirmed" as const, eventIds: result.effectEventIds }
        : result;
    } finally {
      await storage.close();
    }
  }

  async supersede(
    plan: OperatingActionPlanV1,
    digest: string,
    session: Pick<NodeSupervisionSession, "supersedeTopology">,
  ) {
    const storage = await openProjectStorage(this.root);
    try {
      const effect = (await readSupervisionJsonArtifact(
        storage.artifacts,
        plan.effectHash,
      )) as AutomaticTopologyEffectV1;
      return await session.supersedeTopology(effect, plan, digest);
    } finally {
      await storage.close();
    }
  }

  async execute(plan: OperatingActionPlanV1, session: NodeSupervisionEffectSession) {
    const storage = await openProjectStorage(this.root);
    try {
      const sourceReader = new SupervisionTaskSource(storage, this.binding, this.now);
      const source = await sourceReader.read(operatingDecisionId(plan));
      const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
      if (
        operatingContractHash({
          authorityDigest: authority.source.sourceRevisionDigest,
          taskDigest: source.sourceRevisionDigest,
        }) !== plan.sourceRevisionDigest
      )
        throw new Error("The topology effect no longer has its admitted source.");
      const basis = await readCanonicalSupervisionTopology({
        repositoryRoot: this.root,
        source,
        artifacts: storage.artifacts,
        plan,
        now: this.now,
      });
      const head = storage.events.latest()?.eventHash;
      const observedAt = this.now();
      const result = await session.materializeTopology(
        basis.effect,
        plan,
        async () => {
          const current = await sourceReader.read(operatingDecisionId(plan));
          if (current.sourceRevisionDigest !== source.sourceRevisionDigest)
            throw new Error("The topology task source changed before materialization.");
          return (
            await readCanonicalSupervisionTopology({
              repositoryRoot: this.root,
              source: current,
              artifacts: storage.artifacts,
              plan,
              now: this.now,
            })
          ).topology;
        },
        async (created) => {
          const assignments = await listAssignments(this.root);
          const predecessor =
            created === null
              ? assignments
              : assignments.filter((item) => item.assignmentId !== created.assignmentId);
          if (
            operatingContractHash(predecessor) !== operatingContractHash(basis.assignments) ||
            operatingContractHash(await listAgents(this.root)) !==
              operatingContractHash(source.agents) ||
            (await readCurrentWorkstreamState(this.root))?.contentHash !== source.workstreamHash ||
            storage.events.latest()?.eventHash !== head
          )
            throw new Error("Canonical topology sources changed at materialization.");
          const workforce = await observeSupervisionWorkforce({
            repositoryRoot: this.root,
            projectId: plan.projectId,
            ownerAgentId: plan.ownerAgentId,
            provider: basis.effect.provider as "codex" | "claude",
            responsibility: basis.effect.responsibility,
            now: this.now,
          });
          const age = Date.parse(this.now()) - Date.parse(observedAt);
          if (
            !Number.isFinite(age) ||
            age < 0 ||
            age > 5000 ||
            Date.parse(this.now()) >= Date.parse(plan.deadline) ||
            operatingContractHash(workforce.candidates) !==
              operatingContractHash(basis.workforce.candidates) ||
            workforce.activeWorkers !== basis.workforce.activeWorkers ||
            storage.events.latest()?.eventHash !== head
          )
            throw new Error("Topology workforce or budget evidence changed before commit.");
        },
      );
      if (result.status !== "confirmed")
        throw new Error("The topology effect requires inspection.");
      return { eventIds: result.effectEventIds };
    } finally {
      await storage.close();
    }
  }
}
