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
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";

/**
 * Supersedes a responsibility claim whose binding was never written, once its source changed or
 * its start or plan deadline passed, so the owner can decide again instead of holding the goal.
 */
export async function supersedeUnstartedResponsibilityClaim(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  sourceRevisionDigest: string;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
}): Promise<boolean> {
  const plan = structuredClone(input.plan);
  if (plan.effectContract !== "work.responsibility_claim.v1") return false;
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const admitted = await readAdmittedControlDecision(storage, plan);
    if (
      (await inspectSupervisionClaim(storage, input.binding, plan, input.now)).status !==
      "not_started"
    )
      return false;
    const basis = await readSupervisionClaimReceiptBasis(storage, input.binding, plan, input.now);
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
    // A claim can never bind after its start deadline, which precedes the plan deadline.
    const deadlineExpired =
      Math.min(Date.parse(plan.deadline), Date.parse(basis.effect.responsibility.startDeadline)) <=
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
      assignmentId: basis.effect.responsibility.assignmentId,
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
        basis.effect.responsibility.startDeadline,
      )
    )
      throw new Error("Claim supersession requires exact source or deadline evidence.");
    const artifact = await storage.artifacts.put(canonicalJson(inspection));
    const after = await observe();
    if (after.digest !== before.digest)
      throw new Error("Claim absence sources changed before supersession.");
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
          storage.events.get(basis.bindingEventId) !== null
        )
          throw new Error("Claim absence changed at the fenced transition.");
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
        if (result.redactions.length !== 0) throw new Error("Claim absence evidence was redacted.");
      }),
    );
    return true;
  } finally {
    await storage.close();
  }
}
