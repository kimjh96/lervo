import { lstat } from "node:fs/promises";
import { lstatSync } from "node:fs";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { listWorkspaceCoordinationEvents, readWorkspace } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  isWorkspacePreparationAbsence,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import {
  observeNodeSupervisionAuthority,
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import { assertSupervisionWorkspaceLocation } from "./supervision-workspace-plan.js";
import { supervisionWorkspaceReceiptBasis } from "./supervision-workspace-receipt.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import {
  observeUnhostedWorkspace,
  withdrawUnhostedWorkspace,
} from "./supervision-unhosted-workspace.js";

function pathAbsentSync(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

/** Withdraws only an unstarted obsolete host plan; it never changes the task, lease, or checkout. */
export async function supersedeUnstartedWorkspacePreparation(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  sourceRevisionDigest: string;
  configuration: NonNullable<NodeRuntimeReadinessConfiguration["workerWorkspace"]>;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
}): Promise<boolean> {
  const { plan } = input;
  if (plan.effectContract !== "work.workspace_preparation.v1") return false;
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const basis = await supervisionWorkspaceReceiptBasis(storage, plan);
    await assertSupervisionWorkspaceLocation(
      input.repositoryRoot,
      basis.provision,
      input.configuration,
    );
    const workspaceId = basis.provision.workspace.workspaceId;
    const absent = async () => {
      if (
        storage.events.get(basis.eventId) !== null ||
        (await readWorkspace(input.repositoryRoot, workspaceId)) !== null
      )
        return false;
      const coordinates = await listWorkspaceCoordinationEvents(input.repositoryRoot);
      if (
        coordinates.some(
          (event) =>
            event.workspaceId === workspaceId ||
            [
              basis.provision.provisionEventId,
              basis.provision.readyEventId,
              basis.provision.recoveryEventId,
            ].includes(event.eventId),
        )
      )
        return false;
      try {
        await lstat(basis.provision.workspacePath);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const observed = await new GitWorkspaceHostAdapter().inspect({
        repositoryRoot: input.repositoryRoot,
        workspacePath: basis.provision.workspacePath,
        baseCommit: basis.provision.baseCommit,
        marker: basis.provision.marker,
      });
      return observed.status === "absent";
    };
    // A record whose host effect never happened is withdrawn with the plan instead of pinning it.
    const unhosted = async () =>
      storage.events.get(basis.eventId) === null &&
      (await observeUnhostedWorkspace({
        repositoryRoot: input.repositoryRoot,
        plan,
        provision: basis.provision,
      })) !== null;
    const recordAbsent = await absent();
    if (!recordAbsent && !(await unhosted())) return false;
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
    const withoutDecision = await tasks.read(operatingDecisionId(plan));
    const sourceChanged =
      operatingContractHash({
        authorityDigest: before.authority.source.sourceRevisionDigest,
        taskDigest: withoutDecision.sourceRevisionDigest,
      }) !== plan.sourceRevisionDigest;
    const expired = Date.parse(plan.deadline) <= Date.parse(input.now());
    if ((!sourceChanged && !expired) || before.digest !== input.sourceRevisionDigest) return false;
    if (!recordAbsent)
      await withdrawUnhostedWorkspace({
        repositoryRoot: input.repositoryRoot,
        plan,
        provision: basis.provision,
        now: input.now,
      });
    const recordEvidence = recordAbsent
      ? { workspaceRecordAbsent: true, coordinationEventsAbsent: true }
      : { workspaceRecordWithdrawn: true, readyEventAbsent: true };
    const inspection = {
      schemaVersion: recordAbsent ? 3 : 9,
      kind: "work.effect_absence",
      effectContract: plan.effectContract,
      decisionId: operatingDecisionId(plan),
      planHash: operatingContractHash(plan),
      effectHash: plan.effectHash,
      sourceRevisionDigest: input.sourceRevisionDigest,
      workspaceId,
      provisionPlanHash: basis.effect.provisionPlanHash,
      ...recordEvidence,
      hostRegistrationAbsent: true,
      workspacePathAbsent: true,
      eventHeadHash: storage.events.latest()?.eventHash ?? null,
      observedAt: input.now(),
      invalidatedBy: expired ? "deadline_expired" : "source_changed",
    };
    if (
      !isWorkspacePreparationAbsence(inspection, plan, input.sourceRevisionDigest, {
        workspaceId,
        provisionPlanHash: basis.effect.provisionPlanHash,
      })
    )
      throw new Error("Workspace supersession requires exact absence evidence.");
    const artifact = await storage.artifacts.put(canonicalJson(inspection));
    if (!(recordAbsent ? await absent() : await unhosted())) return false;
    const after = await observe();
    if (
      after.digest !== before.digest ||
      after.authority.installation.revoked ||
      !after.authority.source.eligible
    )
      throw new Error("Workspace absence authority changed before supersession.");
    const coordinates = supervisionJournalCoordinates(
      storage,
      input.binding,
      after.source.workstream.revision,
    );
    input.session.commit(() =>
      storage.events.transact((transaction) => {
        const age = Date.parse(input.now()) - Date.parse(inspection.observedAt);
        if (
          age < 0 ||
          age > 5000 ||
          !Number.isFinite(age) ||
          Date.parse(input.now()) >= Date.parse(after.authority.installation.mandate.expiresAt) ||
          storage.events.latest()?.eventHash !== inspection.eventHeadHash ||
          !pathAbsentSync(basis.provision.workspacePath)
        )
          throw new Error("Workspace absence evidence changed before commit.");
        const type = "work.supervision.decision.superseded";
        const result = transaction.append({
          eventId: `evt_${operatingContractHash({ runId: basis.runId, type, identity: basis.identity }).slice(7, 39)}`,
          projectId: plan.projectId,
          runId: basis.runId,
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
            causationEventIds: [basis.decision.eventId],
            decisionId: basis.identity,
            planHash: operatingContractHash(plan),
            inspectionArtifactHash: artifact.contentHash,
            sourceRevisionDigest: input.sourceRevisionDigest,
          },
        });
        if (result.redactions.length !== 0)
          throw new Error("Workspace absence evidence was redacted.");
      }),
    );
    return true;
  } finally {
    await storage.close();
  }
}
