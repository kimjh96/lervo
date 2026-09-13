import type {
  OperatingActionPlanV1,
  SupervisedManagedExecution,
} from "@lervo/application-contract";
import {
  assertAssignmentExecutionAuthority,
  openRepositorySupervisionLeases,
  SupervisionDecisionJournal,
  SupervisionResponsibilityReader,
  type SupervisionOwnerLease,
} from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { readSupervisionWorkspaceSource } from "./supervision-workspace-source.js";
import {
  operatingContractHash,
  operatingDecisionId,
  supervisedManagedExecutionFields,
} from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  supervisionJournalCoordinates,
} from "./supervision-authority.js";

/** Private host-to-worker handoff. The owner token must never enter artifacts or logs. */
export interface SupervisedManagedInvocation {
  plan: OperatingActionPlanV1;
  effect: SupervisedManagedExecution;
  authorityDigest: string;
  ownerLease: SupervisionOwnerLease;
}

/** Reobserves the canonical decision and duties in the actual worker process before invocation. */
export async function admitSupervisedManagedInvocation<T>(input: {
  storage: ProjectStorage;
  invocation: SupervisedManagedInvocation;
  now(): string;
  executionRepositoryRoot?: string;
  commit(): T;
}): Promise<T> {
  const { plan, effect, ownerLease, authorityDigest } = structuredClone(input.invocation);
  const fields = supervisedManagedExecutionFields(effect);
  for (const [key, value] of Object.entries(fields))
    if (
      operatingContractHash(value) !==
      operatingContractHash(plan[key as keyof OperatingActionPlanV1])
    )
      throw new Error("The managed invocation differs from the exact reviewed effect.");
  if (
    plan.projectId !== input.storage.manifest.projectId ||
    ownerLease.supervisionId !== plan.supervisionId ||
    ownerLease.ownerAgentId !== plan.ownerAgentId
  )
    throw new Error("The managed invocation belongs to another authority.");
  const leases = await openRepositorySupervisionLeases(input.storage.paths.repositoryRoot);
  try {
    const currentLease = leases.observeRenewed(ownerLease, Date.parse(input.now()));
    const authority = await observeNodeSupervisionAuthority(input.storage, plan, input.now);
    if (authority.source.sourceRevisionDigest !== authorityDigest)
      throw new Error("The managed invocation authority changed before startup.");
    const coordinates = supervisionJournalCoordinates(
      input.storage,
      plan,
      authority.source.workstreamRevision,
    );
    const journal = new SupervisionDecisionJournal(
      input.storage.events,
      input.storage.artifacts,
      coordinates,
      input.now,
      { store: leases, lease: currentLease },
    );
    const recorded = await journal.findPendingPlan();
    if (
      recorded === null ||
      operatingContractHash(recorded) !== operatingContractHash(plan) ||
      journal.findDecision(operatingDecisionId(plan))?.status !== "recorded"
    )
      throw new Error("The managed invocation has no current recorded decision.");
    const task = await new SupervisionResponsibilityReader(
      input.storage.events,
      input.storage.artifacts,
      coordinates,
      input.now,
    ).current(effect.responsibility.assignmentId);
    if (task?.responsibilityHash !== operatingContractHash(effect.responsibility))
      throw new Error("The managed invocation responsibility changed.");
    const workforce = await assertAssignmentExecutionAuthority({
      repositoryRoot: input.storage.paths.repositoryRoot,
      assignmentId: effect.responsibility.assignmentId,
      agentId: effect.responsibility.executorAgentId,
      leaseId: effect.leaseId,
      provider: effect.provider,
      expectedPaths: effect.responsibility.expectedPaths,
      verificationSuiteIds: effect.responsibility.verificationSuiteIds,
      now: new Date(input.now()),
    });
    if (
      (effect.schemaVersion === 2 &&
        operatingContractHash(workforce.assignment.recovery ?? null) !==
          operatingContractHash(effect.recovery)) ||
      (effect.schemaVersion === 1 && workforce.assignment.recovery !== undefined) ||
      workforce.assignment.revision !== effect.responsibility.assignmentRevision
    )
      throw new Error("The managed invocation assignment revision changed.");
    const workspace = await readSupervisionWorkspaceSource(
      input.storage.paths.repositoryRoot,
      workforce.assignment,
      plan,
      input.storage,
    );
    if (
      input.executionRepositoryRoot !== undefined &&
      workspace.workspacePath !== input.executionRepositoryRoot
    )
      throw new Error("The managed worker is outside its assigned workspace.");
    const refreshed = await observeNodeSupervisionAuthority(input.storage, plan, input.now);
    if (
      refreshed.source.sourceRevisionDigest !== authorityDigest ||
      Date.parse(input.now()) >= Date.parse(plan.deadline)
    )
      throw new Error("The managed invocation admission expired.");
    return leases.commit(
      leases.observeRenewed(currentLease, Date.parse(input.now())),
      Date.parse(input.now()),
      input.commit,
    );
  } finally {
    leases.close();
  }
}

export async function resolveSupervisedManagedWorkspace(
  repositoryRoot: string,
  invocation: SupervisedManagedInvocation,
  now: Date,
): Promise<string> {
  const { effect } = invocation;
  const authority = await assertAssignmentExecutionAuthority({
    repositoryRoot,
    assignmentId: effect.responsibility.assignmentId,
    agentId: effect.responsibility.executorAgentId,
    leaseId: effect.leaseId,
    provider: effect.provider,
    expectedPaths: effect.responsibility.expectedPaths,
    verificationSuiteIds: effect.responsibility.verificationSuiteIds,
    now,
  });
  return (
    await readSupervisionWorkspaceSource(repositoryRoot, authority.assignment, invocation.plan)
  ).workspacePath;
}
