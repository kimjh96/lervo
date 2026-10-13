import { commitSupervisedAssignmentTransition } from "./supervision-assignment-transition.js";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { amendAssignment, amendedAssignment } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import {
  readAssignmentAmendmentEffect,
  readCanonicalAssignmentAmendment,
} from "./supervision-assignment-amendment-source.js";
import {
  assignmentAmendmentEventId,
  inspectAssignmentAmendmentReceipt,
} from "./supervision-assignment-amendment-receipt.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { supersedeUnstartedAssignmentAmendment } from "./supervision-claim-supersession.js";

/** Amends an exact unstarted assignment under the owner fence; it starts no provider process. */
export class SupervisionAssignmentAmendmentEffects {
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
      const observed = await inspectAssignmentAmendmentReceipt(storage, plan);
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
      if (
        last?.payload.status !== "uncertain" ||
        Date.parse(this.now()) >=
          Math.min(Date.parse(plan.deadline), Date.parse(await this.startDeadline(plan)))
      )
        return observed;
      // Retry an interrupted amendment only while it can still take effect. A refused retry
      // leaves the receipt as the outcome, so an inadmissible amendment is superseded instead.
      try {
        const recovered = await this.execute(plan, session);
        return { status: "confirmed" as const, eventIds: recovered.eventIds };
      } catch {
        return await inspectAssignmentAmendmentReceipt(storage, plan);
      }
    } finally {
      await storage.close();
    }
  }
  /** The amendment cannot take effect at or after its responsibility start deadline. */
  async startDeadline(plan: OperatingActionPlanV1): Promise<string> {
    const storage = await openProjectStorage(this.root);
    try {
      return (await readAssignmentAmendmentEffect(storage, plan)).effect.responsibility
        .startDeadline;
    } finally {
      await storage.close();
    }
  }
  /** A never-written amendment is superseded once its source changed or its deadline passed. */
  async supersede(
    plan: OperatingActionPlanV1,
    sourceRevisionDigest: string,
    session: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    return supersedeUnstartedAssignmentAmendment({
      repositoryRoot: this.root,
      binding: this.binding,
      plan,
      sourceRevisionDigest,
      session,
      now: this.now,
    });
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
      const basis = await readCanonicalAssignmentAmendment({
        storage,
        source,
        plan,
        mandate: authority.installation.mandate,
        now: this.now,
      });
      const occurredAt = this.now();
      const expected = amendedAssignment(basis.previous, basis.effect, occurredAt);
      return await commitSupervisedAssignmentTransition({
        storage,
        binding: this.binding,
        plan,
        source,
        authority,
        expected,
        workspaces: basis.workspaces,
        eventId: assignmentAmendmentEventId(plan),
        session,
        now: this.now,
        transition: (recordEvent) =>
          amendAssignment({
            repositoryRoot: this.root,
            effect: basis.effect,
            now: new Date(occurredAt),
            recordEvent,
          }),
      });
    } finally {
      await storage.close();
    }
  }
}
