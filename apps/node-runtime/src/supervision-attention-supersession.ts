import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { inspectSupervisionAttentionReceipt } from "./supervision-attention-receipt.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";

/**
 * Supersedes an owner attention decision whose escalation was never recorded, such as one a
 * preflight blocked. Without this, the pending decision kept the owner from deciding again for
 * the rest of the goal, and the block could never be resolved.
 */
export async function supersedeUnstartedOwnerAttention(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  sourceRevisionDigest: string;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
  /** Other owner controls, such as an artifact review, prove non-start with their own inspector. */
  inspectOwnerControl?: (plan: OperatingActionPlanV1) => Promise<{ status: string }>;
}): Promise<boolean> {
  const plan = structuredClone(input.plan);
  const attention = plan.effectContract === "work.owner_attention.v1";
  if (!attention && input.inspectOwnerControl === undefined) return false;
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const admitted = await readAdmittedControlDecision(storage, plan);
    const notStarted = async () =>
      (attention
        ? await inspectSupervisionAttentionReceipt(storage, plan)
        : await input.inspectOwnerControl!(plan)
      ).status === "not_started";
    if (!(await notStarted())) return false;
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
    const deadlineExpired = Date.parse(plan.deadline) <= Date.parse(input.now());
    if (!sourceChanged && !deadlineExpired) return false;
    if (before.digest !== input.sourceRevisionDigest)
      throw new Error("Owner attention supersession requires the current source.");
    const receiptEventId = attention
      ? `evt_${operatingContractHash({ runId: admitted.runId, type: "work.supervision.escalation.recorded", identity: admitted.identity }).slice(7, 39)}`
      : null;
    const inspection = {
      schemaVersion: 1,
      kind: attention ? "work.owner_attention_absence" : "work.owner_control_absence",
      effectContract: plan.effectContract,
      decisionId: operatingDecisionId(plan),
      planHash: operatingContractHash(plan),
      effectHash: plan.effectHash,
      sourceRevisionDigest: input.sourceRevisionDigest,
      receiptEventId,
      receiptAbsent: true,
      eventHeadHash: storage.events.latest()?.eventHash ?? null,
      observedAt: input.now(),
      invalidatedBy: sourceChanged ? "source_changed" : "deadline_expired",
    };
    const artifact = await storage.artifacts.put(canonicalJson(inspection));
    const after = await observe();
    if (!(await notStarted())) throw new Error("The owner control started before supersession.");
    if (after.digest !== before.digest)
      throw new Error("Owner attention absence sources changed before supersession.");
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
          storage.events.latest()?.eventHash !== inspection.eventHeadHash ||
          (receiptEventId !== null && storage.events.get(receiptEventId) !== null)
        )
          throw new Error("Owner attention absence changed at the fenced transition.");
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
          throw new Error("Owner attention absence evidence was redacted.");
      }),
    );
    return true;
  } finally {
    await storage.close();
  }
}
