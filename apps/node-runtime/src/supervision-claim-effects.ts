import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { listAgents, listAssignments, listWorkspaces } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import {
  readInstalledNodeMandate,
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { NodeSupervisionEffectSession } from "./outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { readCanonicalSupervisionClaim } from "./supervision-claim-source.js";
import {
  inspectSupervisionClaim,
  readSupervisionClaimReceiptBasis,
} from "./supervision-claim-receipt.js";
import { observeSupervisionWorkforce } from "./supervision-workforce-source.js";
import { supersedeUnstartedResponsibilityClaim } from "./supervision-claim-supersession.js";

/** Acquires one exact responsibility under current owner authority; dispatch remains independent. */
export class SupervisionClaimEffects {
  private readonly binding: NodeSupervisionBinding;
  constructor(
    private readonly root: string,
    binding: NodeSupervisionBinding,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
  }
  async inspect(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      return await inspectSupervisionClaim(storage, this.binding, plan, this.now);
    } finally {
      await storage.close();
    }
  }
  /** A never-bound claim is superseded once its source changed or its deadline passed. */
  async supersede(
    plan: OperatingActionPlanV1,
    sourceRevisionDigest: string,
    session: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    return supersedeUnstartedResponsibilityClaim({
      repositoryRoot: this.root,
      binding: this.binding,
      plan,
      sourceRevisionDigest,
      session,
      now: this.now,
    });
  }
  async execute(plan: OperatingActionPlanV1, session: NodeSupervisionEffectSession) {
    const storage = await openProjectStorage(this.root);
    try {
      const receipt = await readSupervisionClaimReceiptBasis(storage, this.binding, plan, this.now);
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
      if (
        operatingContractHash({
          authorityDigest: authority.source.sourceRevisionDigest,
          taskDigest: source.sourceRevisionDigest,
        }) !== plan.sourceRevisionDigest
      )
        throw new Error("The responsibility claim no longer has its admitted source.");
      const installation = await readInstalledNodeMandate(storage, this.binding, this.now);
      const basis = await readCanonicalSupervisionClaim({
        storage,
        repositoryRoot: this.root,
        source,
        artifacts: storage.artifacts,
        plan,
        mandate: installation.mandate,
        now: this.now,
      });
      const assignments = await listAssignments(this.root);
      if (
        basis.workforce.assignmentSourceHash !== operatingContractHash(assignments) ||
        basis.workforce.agentSourceHash !== operatingContractHash(source.agents)
      )
        throw new Error("The workforce sources changed before responsibility acquisition.");
      const head = storage.events.latest()?.eventHash;
      const observedAt = this.now();
      await session.claimResponsibility(receipt.claim, async (transition) => {
        const current = await listAssignments(this.root);
        const others = (items: typeof assignments) =>
          items.filter((item) => item.assignmentId !== basis.assignment.assignmentId);
        if (
          operatingContractHash(others(current)) !== operatingContractHash(others(assignments)) ||
          operatingContractHash(
            current.find((item) => item.assignmentId === transition.assignmentId),
          ) !== operatingContractHash(transition) ||
          operatingContractHash(await listAgents(this.root)) !==
            operatingContractHash(source.agents) ||
          (await readCurrentWorkstreamState(this.root))?.contentHash !== source.workstreamHash ||
          storage.events.latest()?.eventHash !== head
        )
          throw new Error("The canonical claim sources changed at the assignment transition.");
        if (
          operatingContractHash(
            (await listWorkspaces(this.root)).filter(
              (item) => item.assignmentId === basis.assignment.assignmentId,
            ),
          ) !== operatingContractHash(basis.workspaces)
        )
          throw new Error("The responsibility workspace sources changed during claim.");
        const workforce = await observeSupervisionWorkforce({
          repositoryRoot: this.root,
          projectId: plan.projectId,
          ownerAgentId: plan.ownerAgentId,
          provider: basis.effect.provider,
          responsibility: basis.effect.responsibility,
          now: this.now,
        });
        const age = Date.parse(this.now()) - Date.parse(observedAt);
        if (
          !Number.isFinite(age) ||
          age < 0 ||
          age > 5000 ||
          workforce.roleSourceHash !== basis.workforce.roleSourceHash ||
          Date.parse(this.now()) >= Date.parse(basis.effect.responsibility.startDeadline) ||
          storage.events.latest()?.eventHash !== head
        )
          throw new Error("The claim role or resource evidence changed before commit.");
      });
      const result = await inspectSupervisionClaim(storage, this.binding, plan, this.now);
      if (result.status !== "confirmed")
        throw new Error("The responsibility claim requires inspection.");
      return { eventIds: result.eventIds };
    } finally {
      await storage.close();
    }
  }
}
