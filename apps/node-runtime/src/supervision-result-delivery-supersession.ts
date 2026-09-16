import type { OperatingActionPlanV1, SupervisedResultDelivery } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import {
  isResultDeliveryAbsence,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readResultDeliveryReceipt } from "./supervision-result-delivery-receipt.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import type { ProjectStorage } from "@lervo/project-storage";

/** Supersedes a publication decision only while its immutable outbound is still unqueued. */
export async function supersedeUnstartedResultDelivery(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  sourceRevisionDigest: string;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
}): Promise<boolean> {
  const plan = structuredClone(input.plan);
  if (!["work.result_delivery.v1", "work.result_delivery.v2"].includes(plan.effectContract))
    return false;
  const admitted = await readAdmittedControlDecision(input.storage, plan);
  const effect = (await readSupervisionJsonArtifact(
    input.storage.artifacts,
    plan.effectHash,
  )) as SupervisedResultDelivery;
  const receipt = await readResultDeliveryReceipt(input.storage, plan, effect);
  if (receipt.status !== "not_started") return false;
  const tasks = new SupervisionTaskSource(input.storage, input.binding, input.now);
  const observe = async () => {
    const authority = await observeNodeSupervisionAuthority(
      input.storage,
      input.binding,
      input.now,
    );
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
  const deadlineExpired = Date.parse(plan.deadline) <= Date.parse(input.now());
  if (!sourceChanged && !deadlineExpired) return false;
  const inspection = {
    schemaVersion: 8,
    kind: "work.effect_absence",
    effectContract: plan.effectContract,
    decisionId: operatingDecisionId(plan),
    planHash: operatingContractHash(plan),
    effectHash: plan.effectHash,
    sourceRevisionDigest: input.sourceRevisionDigest,
    queueEventId: receipt.eventId,
    queueEventAbsent: true,
    eventHeadHash: input.storage.events.latest()?.eventHash ?? null,
    observedAt: input.now(),
    invalidatedBy: sourceChanged ? "source_changed" : "deadline_expired",
  };
  if (
    before.digest !== input.sourceRevisionDigest ||
    !isResultDeliveryAbsence(inspection, plan, input.sourceRevisionDigest)
  )
    throw new Error("Result delivery supersession requires exact queue absence evidence.");
  const artifact = await input.storage.artifacts.put(canonicalJson(inspection));
  const after = await observe();
  if (after.digest !== before.digest)
    throw new Error("Result delivery absence sources changed before supersession.");
  const coordinates = supervisionJournalCoordinates(
    input.storage,
    input.binding,
    after.source.workstream.revision,
  );
  input.session.commit(() =>
    input.storage.events.transact((transaction) => {
      const age = Date.parse(input.now()) - Date.parse(inspection.observedAt);
      if (
        !Number.isFinite(age) ||
        age < 0 ||
        age > 5000 ||
        Date.parse(input.now()) >= Date.parse(after.authority.installation.mandate.expiresAt) ||
        input.storage.events.latest()?.eventHash !== inspection.eventHeadHash ||
        input.storage.events.get(receipt.eventId) !== null
      )
        throw new Error("Result delivery queue absence changed at the fenced transition.");
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
        throw new Error("Result delivery absence evidence was redacted.");
    }),
  );
  return true;
}
