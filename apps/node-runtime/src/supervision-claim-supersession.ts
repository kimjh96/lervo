import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { listAssignments } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  isResponsibilityClaimAbsence,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import {
  inspectSupervisionClaim,
  readSupervisionClaimReceiptBasis,
} from "./supervision-claim-receipt.js";
import {
  assignmentAmendmentEventId,
  inspectAssignmentAmendmentReceipt,
} from "./supervision-assignment-amendment-receipt.js";
import { readAssignmentAmendmentEffect } from "./supervision-assignment-amendment-source.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import type { ProjectStorage } from "@lervo/project-storage";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";

/** The never-written effect of one successor responsibility revision. */
interface UnwrittenRevision {
  status: "not_started" | "uncertain" | "confirmed";
  assignmentId: string;
  startDeadline: string;
  /** The deterministic event whose absence proves the revision never took effect. */
  effectEventId: string;
}

type RevisionSupersessionInput = {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  sourceRevisionDigest: string;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
};

/**
 * Supersedes a responsibility claim whose binding was never written, once its source changed or
 * its start or plan deadline passed, so the owner can decide again instead of holding the goal.
 */
export function supersedeUnstartedResponsibilityClaim(input: RevisionSupersessionInput) {
  if (input.plan.effectContract !== "work.responsibility_claim.v1") return Promise.resolve(false);
  return supersedeUnwrittenRevision(input, async (storage, plan) => {
    const basis = await readSupervisionClaimReceiptBasis(storage, input.binding, plan, input.now);
    return {
      status: (await inspectSupervisionClaim(storage, input.binding, plan, input.now)).status,
      assignmentId: basis.effect.responsibility.assignmentId,
      startDeadline: basis.effect.responsibility.startDeadline,
      effectEventId: basis.bindingEventId,
    };
  });
}

/** Supersedes an assignment amendment that was never written, under the same evidence as a claim. */
export function supersedeUnstartedAssignmentAmendment(input: RevisionSupersessionInput) {
  if (input.plan.effectContract !== "work.assignment_amendment.v1") return Promise.resolve(false);
  return supersedeUnwrittenRevision(input, async (storage, plan) => {
    const { effect } = await readAssignmentAmendmentEffect(storage, plan);
    return {
      status: (await inspectAssignmentAmendmentReceipt(storage, plan)).status,
      assignmentId: effect.responsibility.assignmentId,
      startDeadline: effect.responsibility.startDeadline,
      effectEventId: assignmentAmendmentEventId(plan),
    };
  });
}

async function supersedeUnwrittenRevision(
  input: RevisionSupersessionInput,
  readRevision: (
    storage: ProjectStorage,
    plan: OperatingActionPlanV1,
  ) => Promise<UnwrittenRevision>,
): Promise<boolean> {
  const plan = structuredClone(input.plan);
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const admitted = await readAdmittedControlDecision(storage, plan);
    const revision = await readRevision(storage, plan);
    if (revision.status !== "not_started") return false;
    const tasks = new SupervisionTaskSource(storage, input.binding, input.now);
    const observe = async () => {
      const authority = await observeNodeSupervisionAuthority(storage, input.binding, input.now);
      const source = await tasks.read();
      return {
        authority,
        source,
        digest: operatingContractHash({
          authorityDigest: authority.source.sourceRevisionDigest,
          taskDigest: source.sourceRevisionDigest,
        }),
      };
    };
    const before = await observe();
    const taskWithoutDecision = await tasks.read(operatingDecisionId(plan));
    const sourceChanged =
      operatingContractHash({
        authorityDigest: before.authority.source.sourceRevisionDigest,
        taskDigest: taskWithoutDecision.sourceRevisionDigest,
      }) !== plan.sourceRevisionDigest;
    // A revision can never take effect after its start deadline, which precedes the plan deadline.
    const deadlineExpired =
      Math.min(Date.parse(plan.deadline), Date.parse(revision.startDeadline)) <=
      Date.parse(input.now());
    if (!sourceChanged && !deadlineExpired) return false;
    const assignments = await listAssignments(input.repositoryRoot);
    const inspection = {
      schemaVersion: 7,
      kind: "work.effect_absence",
      effectContract: plan.effectContract,
      decisionId: operatingDecisionId(plan),
      planHash: operatingContractHash(plan),
      effectHash: plan.effectHash,
      sourceRevisionDigest: input.sourceRevisionDigest,
      assignmentId: revision.assignmentId,
      assignmentSourceHash: operatingContractHash(assignments),
      bindingEventAbsent: true,
      eventHeadHash: storage.events.latest()?.eventHash ?? null,
      observedAt: input.now(),
      invalidatedBy: sourceChanged ? "source_changed" : "deadline_expired",
    };
    if (
      before.digest !== input.sourceRevisionDigest ||
      !isResponsibilityClaimAbsence(
        inspection,
        plan,
        input.sourceRevisionDigest,
        revision.startDeadline,
      )
    )
      throw new Error("Revision supersession requires exact source or deadline evidence.");
    const artifact = await storage.artifacts.put(canonicalJson(inspection));
    const after = await observe();
    if (after.digest !== before.digest)
      throw new Error("Revision absence sources changed before supersession.");
    const coordinates = supervisionJournalCoordinates(
      storage,
      input.binding,
      after.source.workstream.revision,
    );
    input.session.commit(() =>
      storage.events.transact((transaction) => {
        const age = Date.parse(input.now()) - Date.parse(inspection.observedAt);
        if (
          !Number.isFinite(age) ||
          age < 0 ||
          age > 5000 ||
          Date.parse(input.now()) >= Date.parse(after.authority.installation.mandate.expiresAt) ||
          storage.events.latest()?.eventHash !== inspection.eventHeadHash ||
          storage.events.get(revision.effectEventId) !== null
        )
          throw new Error("Revision absence changed at the fenced transition.");
        const type = "work.supervision.decision.superseded";
        const result = transaction.append({
          eventId: `evt_${operatingContractHash({ runId: admitted.runId, type, identity: admitted.identity }).slice(7, 39)}`,
          projectId: plan.projectId,
          runId: admitted.runId,
          sessionId: coordinates.sessionId,
          schemaVersion: 3,
          type,
          occurredAt: input.now(),
          actor: { kind: "system" },
          policyVersion: coordinates.policyVersion,
          payload: {
            schemaVersion: 1,
            projectId: plan.projectId,
            workstreamId: plan.workstreamId,
            workstreamRevision: coordinates.workstreamRevision,
            supervisionId: plan.supervisionId,
            ownerAgentId: plan.ownerAgentId,
            mandateHash: plan.mandateHash,
            causationEventIds: [admitted.decision.eventId],
            decisionId: admitted.identity,
            planHash: operatingContractHash(plan),
            inspectionArtifactHash: artifact.contentHash,
            sourceRevisionDigest: input.sourceRevisionDigest,
          },
        });
        if (result.redactions.length !== 0)
          throw new Error("Revision absence evidence was redacted.");
      }),
    );
    return true;
  } finally {
    await storage.close();
  }
}
