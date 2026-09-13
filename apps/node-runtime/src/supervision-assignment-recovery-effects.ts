import { commitSupervisedAssignmentTransition } from "./supervision-assignment-transition.js";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { reopenAssignment } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { readCanonicalAssignmentRecovery } from "./supervision-assignment-recovery-source.js";
import {
  assignmentRecoveryEventId,
  inspectAssignmentRecoveryReceipt,
} from "./supervision-assignment-recovery-receipt.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";

/** Reopens a rejected terminal assignment under the owner fence; it starts no provider process. */
export class SupervisionAssignmentRecoveryEffects {
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
    session?: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    const storage = await openProjectStorage(this.root);
    try {
      const observed = await inspectAssignmentRecoveryReceipt(storage, plan);
      if (observed.status !== "not_started" || session === undefined) return observed;
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const last = source.events.findLast(
        (event) =>
          event.type === "work.supervision.effect.observed" &&
          event.payload.decisionId === operatingDecisionId(plan) &&
          event.payload.planHash === operatingContractHash(plan),
      );
      if (last?.payload.status !== "uncertain") return observed;
      const recovered = await this.execute(plan, session);
      return { status: "confirmed" as const, eventIds: recovered.eventIds };
    } finally {
      await storage.close();
    }
  }
  async execute(
    plan: OperatingActionPlanV1,
    session: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    const storage = await openProjectStorage(this.root);
    try {
      await readAdmittedControlDecision(storage, plan);
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
      const basis = await readCanonicalAssignmentRecovery({
        storage,
        source,
        plan,
        mandate: authority.installation.mandate,
        now: this.now,
      });
      const occurredAt = this.now();
      const expected = {
        ...basis.previous,
        status: "queued" as const,
        lease: null,
        lastLeaseGeneration: basis.effect.recovery.predecessorLeaseGeneration,
        recovery: basis.effect.recovery,
        revision: basis.previous.revision + 1,
        updatedAt: occurredAt,
      };
      return await commitSupervisedAssignmentTransition({
        storage,
        binding: this.binding,
        plan,
        source,
        authority,
        expected,
        workspaces: basis.workspaces,
        eventId: assignmentRecoveryEventId(plan),
        session,
        now: this.now,
        transition: (recordEvent) =>
          reopenAssignment({
            repositoryRoot: this.root,
            assignmentId: basis.previous.assignmentId,
            recovery: basis.effect.recovery,
            ...(basis.effect.schemaVersion === 2
              ? { settledLeaseId: basis.effect.settledLeaseId }
              : {}),
            now: new Date(occurredAt),
            recordEvent,
          }),
      });
    } finally {
      await storage.close();
    }
  }
}
