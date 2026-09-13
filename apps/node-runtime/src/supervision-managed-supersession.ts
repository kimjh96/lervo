import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  isManagedExecutionAbsence,
  observeManagedExecutionAbsenceEvents,
  managedExecutionAbsenceEventsMatch,
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";

/** The worker must reserve under its owner token before provider startup; recovery fences that token. */
export async function supersedeUnstartedManagedExecution(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  sourceRevisionDigest: string;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
}): Promise<boolean> {
  const plan = structuredClone(input.plan);
  if (!["work.managed_execution.v1", "work.managed_execution.v2"].includes(plan.effectContract))
    return false;
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const admitted = await readAdmittedControlDecision(storage, plan);
    const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
    const runEvidence = observeManagedExecutionAbsenceEvents(
      plan,
      collectRunEventsBounded({
        events: storage.events,
        runId: identity.runId,
        maximumEvents: 4096,
      }),
    );
    if (runEvidence === null) return false;
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
    const expired = Date.parse(plan.deadline) <= Date.parse(input.now());
    if (!sourceChanged && !expired) return false;
    const inspection = {
      ...runEvidence,
      kind: "work.effect_absence",
      effectContract: plan.effectContract,
      decisionId: operatingDecisionId(plan),
      planHash: operatingContractHash(plan),
      effectHash: plan.effectHash,
      sourceRevisionDigest: input.sourceRevisionDigest,
      ...identity,
      eventHeadHash: storage.events.latest()?.eventHash ?? null,
      observedAt: input.now(),
      invalidatedBy: expired ? "deadline_expired" : "source_changed",
    };
    if (
      before.digest !== input.sourceRevisionDigest ||
      !isManagedExecutionAbsence(inspection, plan, input.sourceRevisionDigest)
    )
      throw new Error("Managed execution supersession requires an exact changed source.");
    const artifact = await storage.artifacts.put(canonicalJson(inspection));
    const after = await observe();
    if (
      after.digest !== before.digest ||
      after.authority.installation.revoked ||
      !after.authority.source.eligible
    )
      throw new Error("Managed execution absence sources changed before supersession.");
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
          !managedExecutionAbsenceEventsMatch(
            inspection,
            plan,
            collectRunEventsBounded({
              events: storage.events,
              runId: identity.runId,
              maximumEvents: 4096,
            }),
          )
        )
          throw new Error("Managed execution absence changed at the fenced transition.");
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
          throw new Error("Managed execution absence evidence was redacted.");
      }),
    );
    return true;
  } finally {
    await storage.close();
  }
}
