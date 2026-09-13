import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { readWorkspace } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import {
  assertSupervisionWorkspaceLocation,
  readCanonicalWorkspacePreparation,
} from "./supervision-workspace-plan.js";
import {
  recordSupervisionWorkspaceReceipt,
  supervisionWorkspaceReceiptBasis,
} from "./supervision-workspace-receipt.js";
import { readSupervisionWorkspaceSource } from "./supervision-workspace-source.js";

/** Repairs only a missing receipt for an exact ready workspace; it never provisions or cleans up. */
export async function recoverPreparedWorkspace(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  configuration: NonNullable<NodeRuntimeReadinessConfiguration["workerWorkspace"]>;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
}) {
  const { storage, plan } = input;
  const receipt = await supervisionWorkspaceReceiptBasis(storage, plan);
  const stored = await readWorkspace(
    storage.paths.repositoryRoot,
    receipt.provision.workspace.workspaceId,
  );
  if (
    stored?.workspace.state !== "ready" ||
    stored.workspace.revision !== 2 ||
    storage.events.get(receipt.eventId) !== null
  )
    return { status: "uncertain" as const };
  const tasks = new SupervisionTaskSource(storage, input.binding, input.now);
  const source = await tasks.read(operatingDecisionId(plan));
  const basis = await readCanonicalWorkspacePreparation({ ...input, source });
  await assertSupervisionWorkspaceLocation(
    storage.paths.repositoryRoot,
    basis.provision,
    input.configuration,
  );
  await readSupervisionWorkspaceSource(
    storage.paths.repositoryRoot,
    basis.assignment,
    input.binding,
    storage,
  );
  const authority = await observeNodeSupervisionAuthority(storage, input.binding, input.now);
  const refreshed = await tasks.read(operatingDecisionId(plan));
  if (
    authority.installation.revoked ||
    !authority.source.eligible ||
    operatingContractHash({
      authorityDigest: authority.source.sourceRevisionDigest,
      taskDigest: refreshed.sourceRevisionDigest,
    }) !== plan.sourceRevisionDigest ||
    refreshed.sourceRevisionDigest !== source.sourceRevisionDigest ||
    Date.parse(input.now()) >=
      Math.min(Date.parse(plan.deadline), Date.parse(authority.installation.mandate.expiresAt))
  )
    throw new Error("The ready workspace no longer has its exact preparation authority.");
  const result = await recordSupervisionWorkspaceReceipt({
    storage,
    plan,
    now: input.now,
    commit: (effect) =>
      input.session.commit(() => {
        if (storage.events.latest()?.eventHash !== refreshed.events.at(-1)?.eventHash)
          throw new Error("The workspace recovery source changed before receipt commit.");
        return effect();
      }),
  });
  return { status: "confirmed" as const, eventIds: result.eventIds };
}
