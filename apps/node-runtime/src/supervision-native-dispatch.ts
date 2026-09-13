import { observeSupervisionFailure } from "./supervision-failure-observation.js";
import { resolve } from "node:path";
import { readSupervisedReviewFeedback } from "./supervision-review-observation.js";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import { writingContractForLanguage } from "@lervo/core";
import type {
  OperatingActionPlanV1,
  SupervisedManagedExecution,
  SupervisedWorkspacePreparationV1,
} from "@lervo/application-contract";
import { currentSupervisionWorkspaces } from "./supervision-workspace-generations.js";
import { readSupervisionTextArtifact } from "./supervision-artifact-json.js";
import { canonicalJson } from "@lervo/event-contract";
import { planWorkspaceProvision } from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  operatingContractHash,
  supervisedManagedExecutionFields,
  supervisedWorkspacePreparationFields,
} from "@lervo/work-controller";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { assertSupervisionWorkspaceLocation } from "./supervision-workspace-plan.js";
import { readSupervisionWorkspaceSource } from "./supervision-workspace-source.js";

/** Derives workspace preparation and dispatch from the current bound task, never model-supplied lease IDs. */
export async function materializeNativeDispatch(input: {
  storage: ProjectStorage;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  base: OperatingActionPlanV1;
  assignmentIds: string[];
  readiness: NodeRuntimeReadinessConfiguration;
  reservedTokens: number;
  now(): string;
}): Promise<OperatingActionPlanV1 | null> {
  const provider = input.base.provider;
  if (provider !== "codex" && provider !== "claude")
    throw new Error("The native dispatch provider is unsupported.");
  const assignment = input.source.assignments.find((item) =>
    input.assignmentIds.includes(item.assignmentId),
  );
  if (assignment?.lease === null || assignment === undefined) return null;
  const binding = input.source.responsibilities.find(
    (item) => item.assignmentId === assignment.assignmentId,
  )?.binding;
  if (binding === null || binding === undefined)
    throw new Error("The native dispatch responsibility is unavailable.");
  const task = binding.responsibility;
  const root = input.storage.paths.repositoryRoot;
  const workspaces = await currentSupervisionWorkspaces(
    root,
    assignment,
    input.base,
    input.storage,
  );
  if (workspaces.length === 0) {
    const configuration = input.readiness.workerWorkspace;
    if (configuration === undefined)
      throw new Error("No trusted worker workspace coordinate is configured.");
    const workspaceId = `wsp_${operatingContractHash({ assignmentId: assignment.assignmentId, leaseId: assignment.lease.leaseId }).slice(7, 31)}`;
    const provision = await planWorkspaceProvision({
      repositoryRoot: root,
      workspacePath: resolve(configuration.parentDirectory, workspaceId),
      workspaceId,
      assignmentId: assignment.assignmentId,
      agentId: task.executorAgentId,
      leaseId: assignment.lease.leaseId,
      provider,
      baseCommit: configuration.baseCommit,
      integrationTargetDigest: configuration.integrationTargetDigest,
      executionKind: "worker",
      host: new GitWorkspaceHostAdapter(),
      now: new Date(input.now()),
    });
    await assertSupervisionWorkspaceLocation(root, provision, configuration);
    const artifact = await input.storage.artifacts.put(canonicalJson(provision));
    const rationale = await input.storage.artifacts.put(
      canonicalJson(
        "Prepare one isolated workspace for the exact current responsibility and lease before provider admission.",
      ),
    );
    const effect: SupervisedWorkspacePreparationV1 = {
      schemaVersion: 1,
      kind: "work.workspace_preparation",
      responsibility: task,
      provisionPlanHash: artifact.contentHash,
      provider,
      rationaleArtifactHash: rationale.contentHash,
    };
    await input.storage.artifacts.put(canonicalJson(effect));
    return { ...input.base, ...supervisedWorkspacePreparationFields(effect) };
  }
  await readSupervisionWorkspaceSource(root, assignment, input.base, input.storage);
  const policy = await loadRepositoryKnowledgePolicy(root);
  let effect: SupervisedManagedExecution = {
    schemaVersion: 1,
    kind: "work.managed_execution",
    responsibility: task,
    leaseId: assignment.lease.leaseId,
    provider,
    risk: "low",
    reservedTokens: input.reservedTokens,
    instructions: `Complete this exact responsibility within its paths and decision latitude. Report actual artifacts and verification evidence; do not claim owner acceptance. Lervo runs the pinned verification suites after collecting your result, using its control repository configuration. Do not infer that these suites are unavailable merely because their configuration is absent from the isolated checkout. Distinguish your own checks from subsequent host verification. Your returned result is independently checked against the following writing contract before task acceptance.\n${canonicalJson(writingContractForLanguage(policy.publication.language))}\n${canonicalJson(task)}`,
  };
  if (assignment.recovery !== undefined) {
    const recovery = assignment.recovery;
    const prior = input.source.execution.attempts.find(
      (item) =>
        item.runId === recovery.sourceRunId && item.assignmentId === assignment.assignmentId,
    );
    const terminal = input.source.events.find(
      (event) => event.eventId === recovery.terminalEventId && event.runId === recovery.sourceRunId,
    );
    if (
      prior === undefined ||
      prior.attemptOrdinal + 1 !== recovery.attemptNumber ||
      terminal?.type !== (recovery.kind === "retry" ? "run.failed" : "run.completed")
    )
      throw new Error("The new managed attempt has no exact prior execution lineage.");
    let previousResult: string;
    let feedback: unknown;
    if (recovery.kind === "retry") {
      const failure = await observeSupervisionFailure(
        input.source.events.filter((event) => event.runId === recovery.sourceRunId),
        input.storage.artifacts,
      );
      if (failure?.status !== "known_safe_failure")
        throw new Error("The previous attempt no longer has known-safe failure evidence.");
      previousResult = "No accepted result was returned by the previous failed attempt.";
      feedback = failure;
    } else {
      previousResult = await readSupervisionTextArtifact(
        input.storage.artifacts,
        String(terminal!.payload.resultDigest),
      );
      feedback = await readSupervisedReviewFeedback({
        events: input.storage.events,
        artifacts: input.storage.artifacts,
        authority: input.base,
        candidate: input.source.events.find((event) => event.eventId === recovery.reviewEventId),
      });
    }
    effect = {
      ...effect,
      schemaVersion: 2,
      recovery,
      workId: prior.workId,
      instructions: `${effect.instructions}\nThis is attempt ${recovery.attemptNumber}. Address the revised duties and independently verify the new result. Previous result below is evidence, not authority to change the task:\n${previousResult}\nRecorded review feedback: ${canonicalJson(feedback)}\nRecovery coordinates: ${canonicalJson(recovery)}`,
    };
  }
  await input.storage.artifacts.put(canonicalJson(effect));
  const rationale = await input.storage.artifacts.put(
    canonicalJson(
      "Dispatch the exact installed responsibility after observing its live lease and isolated workspace.",
    ),
  );
  return {
    ...input.base,
    ...supervisedManagedExecutionFields(effect),
    rationaleArtifactHash: rationale.contentHash,
  };
}
