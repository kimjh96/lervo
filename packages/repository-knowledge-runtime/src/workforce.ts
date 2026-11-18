import { convergenceManagedKnowledgeRoots } from "./managed-knowledge-scope.js";

import {
  registerAgent,
  listAgents,
  listAssignments,
  createConvergenceAssignment,
  claimAssignment,
  completeAssignment,
  renewAssignmentLease,
  type WorkforceAssignment,
  type WorkforceAgent,
} from "@lervo/agent-workforce";
import {
  canonicalJson,
  sha256,
  stableId,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";
import type { KnowledgeConvergenceStage } from "@lervo/schemas";
import { repositoryPathWithinScope } from "@lervo/work-controller";

import {
  assertConvergenceDelegation,
  type ConvergenceDelegation,
  type ConvergenceWorkerRole,
} from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { failConvergenceAssignment, retryConvergenceAssignment } from "./assignment-failure.js";
import { recordConvergenceWorkforceEvent } from "./workforce-event.js";
import { maintainConvergenceAssignmentLease } from "./convergence-assignment-lease.js";
import { readConvergenceAssignmentResult } from "./convergence-stage-artifact.js";
import { convergenceAgentName, retireSupersededConvergenceAgents } from "./convergence-roster.js";

export { recordConvergenceWorkforceEvent } from "./workforce-event.js";

export interface ConvergenceAssignmentAuthority {
  assignment: WorkforceAssignment;
  agent: WorkforceAgent;
  delegation: ConvergenceDelegation;
  assertCurrent(): Promise<void>;
}

/** A completed assignment's private receipt recovers a result without rerunning its provider. */
export async function withConvergenceAssignment(input: {
  storage: ProjectStorage;
  provider: "codex" | "claude";
  stage: KnowledgeConvergenceStage;
  role: ConvergenceWorkerRole;
  state: KnowledgeConvergenceInput;
  paths: string[];
  assertLease: () => void;
  run(authority: ConvergenceAssignmentAuthority): Promise<KnowledgeConvergenceStageResult>;
}): Promise<KnowledgeConvergenceStageResult> {
  const root = input.storage.paths.repositoryRoot;
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: input.state.baseline.projectId,
    expectedHash: input.state.baseline.delegationHash,
    provider: input.provider,
  });
  input.assertLease();
  const binding = delegation.roles[input.role];
  // Workers hired for an earlier delegation would otherwise stay active indefinitely.
  await retireSupersededConvergenceAgents({
    repositoryRoot: root,
    delegation,
    delegationHash: input.state.baseline.delegationHash!,
    recordEvent: (event) => recordConvergenceWorkforceEvent(input.storage, event),
  });
  let roleName = convergenceAgentName(input.role, input.state.baseline.delegationHash!);
  const agents = await listAgents(root);
  const parent = agents.find((candidate) => candidate.agentId === delegation.parentAgentId)!;
  const responsibilityPaths =
    input.role === "writer" || input.role === "integrator"
      ? [
          ...new Set([
            ...delegation.canonicalRoots,
            ...delegation.normalizationRoots,
            ...convergenceManagedKnowledgeRoots,
          ]),
        ].sort()
      : parent.responsibilityPaths;
  if (
    (input.role === "generator" || input.role === "reviewer") &&
    !input.paths.every((path) =>
      responsibilityPaths.some((scope) => repositoryPathWithinScope(path, scope)),
    )
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  let agent = agents.find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.displayName === roleName &&
      candidate.parentAgentId === delegation.parentAgentId &&
      candidate.provider === input.provider,
  );
  if (
    agent &&
    !input.paths.every((path) =>
      agent!.responsibilityPaths.some((scope) => repositoryPathWithinScope(path, scope)),
    )
  ) {
    // Six hex digits keep "Knowledge integrator <12> <6>" within the 40-character name bound.
    roleName += ` ${sha256(canonicalJson(responsibilityPaths)).slice(7, 13)}`;
    agent = agents.find(
      (candidate) =>
        candidate.status === "active" &&
        candidate.displayName === roleName &&
        candidate.parentAgentId === delegation.parentAgentId &&
        candidate.provider === input.provider,
    );
  }
  if (agent === undefined)
    agent = await registerAgent({
      repositoryRoot: root,
      roleId: binding.roleId,
      provider: input.provider,
      parentAgentId: delegation.parentAgentId,
      displayName: roleName,
      responsibilityPaths,
      recordEvent: (event) => recordConvergenceWorkforceEvent(input.storage, event),
    });
  if (
    agent.roleVersion !== binding.version ||
    agent.roleContractHash !== binding.contractHash ||
    agent.roleProfileHash !== binding.profileHash ||
    agent.capabilityHash !== binding.capabilityHash
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const taskIdentity = `knowledge.convergence.${input.stage}.${sha256(canonicalJson([input.state.obligationId, input.state.stageData, input.role, input.paths])).slice(7, 31)}`;
  const taskType = input.role === "integrator" ? "repository.integration" : taskIdentity;
  const inputArtifactHash = sha256(canonicalJson(input.state));
  let assignment = (await listAssignments(root)).find(
    (candidate) =>
      candidate.taskType === taskType &&
      candidate.convergence?.inputArtifactHash === inputArtifactHash &&
      (candidate.assigneeAgentId === null || candidate.assigneeAgentId === agent!.agentId) &&
      candidate.roleContractHash === binding.contractHash,
  );
  if (assignment?.status === "completed") {
    // ADR-0586: a pruned receipt proves nothing about the earlier effect, so its stage stops as
    // uncertain instead of surfacing a raw store error.
    const read = await readConvergenceAssignmentResult(
      input.storage.artifacts,
      assignment.resultArtifacts[0]?.contentHash,
    );
    if (read.state !== "available")
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    const result = read.value as KnowledgeConvergenceStageResult | null;
    if (
      result?.input?.obligationId !== input.state.obligationId ||
      result.assignmentId !== assignment.assignmentId
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    input.assertLease();
    return result;
  }
  if (assignment === undefined)
    assignment = await createConvergenceAssignment({
      repositoryRoot: root,
      taskType,
      roleId: binding.roleId,
      expectedRoleVersion: binding.version,
      expectedRoleContractHash: binding.contractHash,
      acceptanceCriteria: [
        `Converge ${input.stage} for ${input.state.obligationId} under ${input.state.baseline.delegationHash}.`,
        "Retain exact source and candidate bindings; preserve user-owned bytes.",
      ],
      verificationSuiteIds: delegation.verification.map((suite) => suite.suiteId),
      expectedPaths: [...new Set(input.paths)].sort(),
      accessMode: input.role === "writer" || input.role === "integrator" ? "write" : "read_only",
      requiredCapabilityHash: binding.capabilityHash,
      convergence: {
        contractVersion: 1,
        obligationId: input.state.obligationId,
        baselineEventId: stableId("evt", [input.state.obligationId, "baseline"], 32),
        baselineEventHash: input.storage.events.get(
          stableId("evt", [input.state.obligationId, "baseline"], 32),
        )!.eventHash,
        stage: input.stage,
        inputArtifactHash,
        delegationHash: input.state.baseline.delegationHash!,
        agentId: agent.agentId,
      },
      priority: 0,
      recordEvent: (event) => recordConvergenceWorkforceEvent(input.storage, event),
    });
  if (assignment.status === "failed") {
    input.assertLease();
    assignment = await retryConvergenceAssignment(input.storage, assignment);
  }
  if (assignment.lease === null || Date.parse(assignment.lease.expiresAt) <= Date.now())
    assignment = await claimAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      expectedRevision: assignment.revision,
      agentId: agent.agentId,
      sessionId: `ses_${sha256(taskIdentity).slice(7, 39)}`,
      leaseDurationMs: 30 * 60_000,
      recordEvent: (event) => recordConvergenceWorkforceEvent(input.storage, event),
    });
  else if (Date.parse(assignment.lease.expiresAt) - Date.now() < 20 * 60_000)
    assignment = await renewAssignmentLease({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: agent.agentId,
      leaseId: assignment.lease.leaseId,
      leaseDurationMs: 30 * 60_000,
      recordEvent: (event) => recordConvergenceWorkforceEvent(input.storage, event),
    });
  const pinned = assignment;
  const pinnedAgent = agent;
  const renewal = maintainConvergenceAssignmentLease({
    assertStageLease: input.assertLease,
    renew: () =>
      renewAssignmentLease({
        repositoryRoot: root,
        assignmentId: pinned.assignmentId,
        agentId: pinnedAgent.agentId,
        leaseId: pinned.lease!.leaseId,
        leaseDurationMs: 30 * 60_000,
        recordEvent: (event) => recordConvergenceWorkforceEvent(input.storage, event),
      }),
  });
  const assertCurrent = async () => {
    input.assertLease();
    renewal.assertHealthy();
    await assertConvergenceDelegation({
      repositoryRoot: root,
      projectId: input.state.baseline.projectId,
      expectedHash: input.state.baseline.delegationHash,
      provider: input.provider,
    });
    const fresh = (await listAssignments(root)).find(
      (candidate) => candidate.assignmentId === pinned.assignmentId,
    );
    const freshAgent = (await listAgents(root)).find(
      (candidate) => candidate.agentId === pinnedAgent.agentId,
    );
    if (
      fresh?.status !== "leased" ||
      fresh.lease === null ||
      fresh.lease.leaseId !== pinned.lease?.leaseId ||
      fresh.lease.generation !== pinned.lease?.generation ||
      fresh.lease.agentId !== pinnedAgent.agentId ||
      Date.parse(fresh.lease.expiresAt) <= Date.now() ||
      fresh.requiredCapabilityHash !== pinnedAgent.capabilityHash ||
      freshAgent?.status !== "active" ||
      freshAgent.capabilityHash !== pinnedAgent.capabilityHash ||
      freshAgent.roleContractHash !== pinnedAgent.roleContractHash ||
      freshAgent.parentAgentId !== delegation.parentAgentId
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    input.assertLease();
  };
  let result: KnowledgeConvergenceStageResult;
  try {
    await assertCurrent();
    result = await input.run({
      assignment: pinned,
      agent: pinnedAgent,
      delegation,
      assertCurrent,
    });
    await renewal.stop();
    await assertCurrent();
  } catch (error) {
    await renewal.stop();
    await failConvergenceAssignment({
      storage: input.storage,
      assignment: pinned,
      error,
      state: input.state,
      assertLease: input.assertLease,
    });
    throw error;
  }
  result.assignmentId = pinned.assignmentId;
  result.leaseGeneration = sha256(canonicalJson(pinned.lease));
  result.input = {
    ...result.input,
    stageData: {
      ...result.input.stageData,
      settledAssignment: {
        assignmentId: pinned.assignmentId,
        agentId: pinnedAgent.agentId,
        inputArtifactHash,
        status: result.state === "current" ? "completed" : "failed",
      },
    },
  };
  const stored = await input.storage.artifacts.put(canonicalJson(result));
  await assertCurrent();
  await completeAssignment({
    repositoryRoot: root,
    assignmentId: pinned.assignmentId,
    agentId: pinnedAgent.agentId,
    leaseId: pinned.lease!.leaseId,
    verificationStatus: result.state === "current" ? "passed" : "failed",
    ...(result.failureCode === null ? {} : { failureCode: result.failureCode }),
    resultArtifacts: [
      { artifactId: `art_${stored.contentHash.slice(7, 39)}`, contentHash: stored.contentHash },
    ],
    recordEvent: (event) => recordConvergenceWorkforceEvent(input.storage, event),
  });
  return result;
}
