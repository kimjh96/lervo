import { randomUUID } from "node:crypto";
import {
  claimAssignment,
  completeAssignment,
  createPinnedAssignment,
  listAgents,
  listAssignments,
  registerAgent,
} from "@lervo/agent-workforce";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import {
  assertConvergenceDelegation,
  loadConvergenceDelegation,
  type ConvergenceWorkerRole,
} from "./delegation.js";
import { practiceAgentName, retireSupersededConvergenceAgents } from "./convergence-roster.js";
import { recordConvergenceWorkforceEvent } from "./workforce-event.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";
import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { PRACTICE_EVENT_SCHEMA_VERSION } from "./practice-events.js";
import { practiceResumeAt } from "./practice-deferral.js";

/** Reuse delegation role pins, workforce leases, path conflict checks and durable completion. */
export async function withPracticeAssignment<T>(input: {
  context: InstructionCaptureContext;
  role: ConvergenceWorkerRole;
  key: string;
  paths: string[];
  prepare?(): Promise<{ release(): Promise<void> }>;
  run(authority: ConvergenceAssignmentAuthority): Promise<T>;
}): Promise<T> {
  if ((input.context.storage.writableEventSchemaVersion ?? 1) < PRACTICE_EVENT_SCHEMA_VERSION)
    throw new Error("practice_reader_activation_pending");
  const prepared = await input.prepare?.();
  try {
    return await runPracticeAssignment(input);
  } finally {
    await prepared?.release();
  }
}

async function runPracticeAssignment<T>(input: {
  context: InstructionCaptureContext;
  role: ConvergenceWorkerRole;
  key: string;
  paths: string[];
  run(authority: ConvergenceAssignmentAuthority): Promise<T>;
}): Promise<T> {
  const { context } = input;
  const root = context.storage.paths.repositoryRoot;
  const loaded = await loadConvergenceDelegation(root);
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: context.storage.manifest.projectId,
    expectedHash: loaded?.contentHash ?? null,
    provider: context.provider,
    now: context.now(),
  });
  const recordEvent = (event: Parameters<typeof recordConvergenceWorkforceEvent>[1]) =>
    recordConvergenceWorkforceEvent(context.storage, event);
  await retireSupersededConvergenceAgents({
    repositoryRoot: root,
    delegation,
    delegationHash: loaded!.contentHash,
    recordEvent,
  });
  const binding = delegation.roles[input.role];
  const agents = await listAgents(root);
  const parent = agents.find((a) => a.agentId === delegation.parentAgentId)!;
  const write = input.role === "writer" || input.role === "integrator";
  const responsibilityPaths = write
    ? [...delegation.canonicalRoots, ...delegation.normalizationRoots]
    : parent.responsibilityPaths;
  const name = practiceAgentName(input.role, loaded!.contentHash);
  const agent =
    agents.find(
      (a) =>
        a.status === "active" &&
        a.displayName === name &&
        a.provider === context.provider &&
        a.parentAgentId === delegation.parentAgentId,
    ) ??
    (await registerAgent({
      repositoryRoot: root,
      roleId: binding.roleId,
      provider: context.provider,
      parentAgentId: delegation.parentAgentId,
      displayName: name,
      responsibilityPaths,
      recordEvent,
    }));
  if (
    agent.roleContractHash !== binding.contractHash ||
    agent.roleVersion !== binding.version ||
    agent.roleProfileHash !== binding.profileHash ||
    agent.capabilityHash !== binding.capabilityHash
  )
    throw new Error("Practice role binding changed.");
  const taskKey = `practice:${input.role}:${sha256(input.key)}`;
  const taskType =
    input.role === "integrator"
      ? "repository.integration"
      : `knowledge.practice.${input.role}.${sha256(input.key).slice(7, 31)}`;
  const previous = (await listAssignments(root)).filter(
    (a) => a.taskType === taskType && a.acceptanceCriteria.includes(taskKey),
  );
  const completed = previous.find((a) => a.status === "completed");
  if (completed?.resultArtifacts[0]) {
    const ref = completed.resultArtifacts[0];
    const bytes = await context.storage.artifacts.get(
      `lervo-cas://sha256/${ref.contentHash.slice(7)}`,
    );
    if (sha256(bytes) !== ref.contentHash) throw new Error("review_invalid");
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
  }
  if (
    previous.filter(
      (a) =>
        a.status === "failed" &&
        a.updatedAt.slice(0, 10) === context.now().toISOString().slice(0, 10),
    ).length >= 3
  )
    throw new Error("practice_budget_exhausted");
  let assignment = previous.find((a) => a.status === "queued" || a.status === "leased");
  assignment ??= await createPinnedAssignment({
    repositoryRoot: root,
    taskType,
    roleId: binding.roleId,
    expectedRoleVersion: binding.version,
    expectedRoleContractHash: binding.contractHash,
    acceptanceCriteria: [
      taskKey,
      "Resolve the exact practice hash under the current delegation; preserve user-owned content.",
    ],
    verificationSuiteIds: delegation.verification.map((s) => s.suiteId),
    expectedPaths: input.paths.length ? input.paths : parent.responsibilityPaths.slice(0, 128),
    accessMode: write ? "write" : "read_only",
    requiredCapabilityHash: binding.capabilityHash,
    recordEvent,
  });
  if (!(
    assignment.status === "leased" &&
    assignment.lease?.agentId === agent.agentId &&
    Date.parse(assignment.lease.expiresAt) > context.now().getTime()
  ))
    assignment = await claimAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      expectedRevision: assignment.revision,
      agentId: agent.agentId,
      sessionId: `ses_${randomUUID().replaceAll("-", "")}`,
      leaseDurationMs: 30 * 60_000,
      now: context.now(),
      recordEvent,
    });
  const pinned = assignment;
  const assertCurrent = async () => {
    if (context.signal.aborted) throw new Error("Practice assignment cancelled.");
    if (write && !(await knowledgeOutputCommitGrant(root, context.now().getTime())).allowed)
      throw new Error("publication_authority_missing");
    await assertConvergenceDelegation({
      repositoryRoot: root,
      projectId: context.storage.manifest.projectId,
      expectedHash: loaded!.contentHash,
      provider: context.provider,
      now: context.now(),
    });
    const current = (await listAssignments(root)).find(
      (a) => a.assignmentId === pinned.assignmentId,
    );
    const active = (await listAgents(root, { readOnly: true })).find(
      (a) => a.agentId === agent.agentId,
    );
    if (
      current?.status !== "leased" ||
      current.lease?.leaseId !== pinned.lease!.leaseId ||
      current.lease.agentId !== agent.agentId ||
      Date.parse(current.lease.expiresAt) <= context.now().getTime() ||
      active?.status !== "active" ||
      active.capabilityHash !== binding.capabilityHash
    )
      throw new Error("Practice assignment lease changed.");
  };
  // Calls are capped at two minutes, within the thirty-minute workforce lease.
  await assertCurrent();
  try {
    const result = await input.run({ assignment: pinned, agent, delegation, assertCurrent });
    await assertCurrent();
    const artifact = await context.storage.artifacts.put(canonicalJson(result));
    await completeAssignment({
      repositoryRoot: root,
      assignmentId: pinned.assignmentId,
      agentId: agent.agentId,
      leaseId: pinned.lease!.leaseId,
      verificationStatus: "passed",
      now: context.now(),
      resultArtifacts: [
        {
          artifactId: `art_${artifact.contentHash.slice(7, 39)}`,
          contentHash: artifact.contentHash,
        },
      ],
      recordEvent,
    });
    return result;
  } catch (error) {
    if (practiceResumeAt(error, context.now()) !== null) throw error;
    await completeAssignment({
      repositoryRoot: root,
      assignmentId: pinned.assignmentId,
      agentId: agent.agentId,
      leaseId: pinned.lease!.leaseId,
      verificationStatus: "failed",
      now: context.now(),
      failureCode: "practice_assessment_failed",
      resultArtifacts: [],
      recordEvent,
    }).catch(() => {});
    throw error;
  }
}
