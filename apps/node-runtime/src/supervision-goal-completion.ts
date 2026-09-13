import type {
  OperatingActionPlanV1,
  SupervisedGoalCompletionV1,
} from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { listAgents, listAssignments } from "@lervo/agent-workforce";
import {
  applyWorkstreamUpdatePlan,
  createWorkstreamUpdatePlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import type { NodeSupervisionSession } from "./supervision-session.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { observeMandateInstallationSource } from "./supervision-authority-source.js";
import {
  expectedGoalCompletion,
  inspectGoalCompletion,
} from "./supervision-goal-completion-receipt.js";
import { readSupervisionOwnerControl } from "./supervision-owner-control.js";

/** Applies only the reviewed completion through the durable workstream transaction. */
export async function recordCanonicalGoalCompletion(input: {
  storage: ProjectStorage;
  tasks: SupervisionTaskSource;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  effect: SupervisedGoalCompletionV1;
  authorityDigest: string;
  session: Pick<NodeSupervisionSession, "readAuthority" | "readMandate" | "commit">;
  now: () => string;
}) {
  const { storage, tasks, binding, session, now } = input;
  const plan = structuredClone(input.plan),
    effect = structuredClone(input.effect);
  const prior = await inspectGoalCompletion(storage, plan, effect);
  if (prior.status === "confirmed") return { eventIds: prior.eventIds };
  const expected = await expectedGoalCompletion(storage, plan, effect);
  const source = await tasks.read(operatingDecisionId(plan));
  const authority = await session.readAuthority();
  if (
    authority.source.sourceRevisionDigest !== input.authorityDigest ||
    plan.sourceRevisionDigest !==
      operatingContractHash({
        authorityDigest: input.authorityDigest,
        taskDigest: source.sourceRevisionDigest,
      }) ||
    plan.graphHash !== source.graph.graphHash ||
    Date.parse(effect.completedAt) < Date.parse(source.workstream.updatedAt) ||
    Date.parse(effect.completedAt) > Date.parse(now())
  )
    throw new Error("The goal completion source or time changed.");
  await readSupervisionOwnerControl({
    source,
    binding,
    events: storage.events,
    artifacts: storage.artifacts,
    plan,
  });
  const original = await readCurrentWorkstreamState(storage.paths.repositoryRoot);
  if (original?.contentHash !== effect.workstreamSnapshotHash)
    throw new Error("The goal completion predecessor changed.");
  const update = await createWorkstreamUpdatePlan({
    repositoryRoot: storage.paths.repositoryRoot,
    projectId: plan.projectId,
    snapshot: expected.snapshot,
  });
  if (
    update.status !== "ready" ||
    update.desiredSnapshotContentHash !== expected.snapshotHash ||
    update.currentSnapshotContentHash !== original.contentHash
  )
    throw new Error("The exact goal completion cannot be applied.");
  await applyWorkstreamUpdatePlan({
    plan: update,
    now: new Date(effect.completedAt),
    actor: "agent",
    recordApplied: async (receipt, content) => {
      if (
        receipt.snapshotContentHash !== expected.snapshotHash ||
        content !== expected.snapshotContent
      )
        throw new Error("The completion transaction changed.");
      const fresh = await observeMandateInstallationSource(
        storage.paths.repositoryRoot,
        storage,
        authority.installation.mandate,
        "current",
        undefined,
        { original, desiredSnapshotHash: expected.snapshotHash },
      );
      const mandate = await session.readMandate();
      const assignments = await listAssignments(storage.paths.repositoryRoot);
      const agents = await listAgents(storage.paths.repositoryRoot);
      const artifact = await storage.artifacts.put(content);
      session.commit(() => {
        if (
          fresh.sourceRevisionDigest !== input.authorityDigest ||
          mandate.revoked ||
          mandate.latestEventId !== authority.installation.latestEventId ||
          Date.parse(now()) >=
            Math.min(Date.parse(plan.deadline), Date.parse(mandate.mandate.expiresAt)) ||
          operatingContractHash(agents) !== operatingContractHash(source.agents) ||
          operatingContractHash(
            assignments.filter((item) => item.workstreamId === plan.workstreamId),
          ) !== operatingContractHash(source.workstreamAssignments) ||
          storage.events.latest()?.eventHash !== source.events.at(-1)?.eventHash ||
          artifact.contentHash !== expected.snapshotHash
        )
          throw new Error("The completion authority changed at commit.");
        storage.events.append({
          eventId: expected.eventId,
          projectId: plan.projectId,
          runId: expected.runId,
          sessionId: expected.decision.sessionId,
          type: "workstream.snapshot.recorded",
          schemaVersion: 3,
          occurredAt: effect.completedAt,
          actor: { kind: "system" },
          policyVersion: plan.mandateHash,
          payload: expected.payload,
        });
      });
    },
  });
  return { eventIds: [expected.eventId] };
}
