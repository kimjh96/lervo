import { listWorkspaces } from "@lervo/agent-workforce";
import { observeUnstartedSupervisionWorkspace } from "./supervision-unstarted-workspace.js";
import { observeSupervisionFailure } from "./supervision-failure-observation.js";
import { readAcceptedSupervisionGoal } from "./supervision-accepted-goal.js";
import { resultWritingContract } from "./conversation-result-publication.js";
import { writingContractForLanguage } from "@lervo/core";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";
import { readRepositoryFile } from "@lervo/context";
import { resolveRoleContract } from "@lervo/roles";
import type { ProjectStorage } from "@lervo/project-storage";
import type { OutcomeSupervisionReportV1 } from "@lervo/application-contract";
import { operatingContractHash } from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { readInstalledNodeMandate, type NodeSupervisionBinding } from "./supervision-authority.js";
import { observeSupervisionTasks } from "./supervision-task-observation.js";
import { loadSupervisionPlanningContext } from "./supervision-planning-context.js";
import { readSupervisionTextArtifact } from "./supervision-artifact-json.js";
import { readSupervisedReviewFeedback } from "./supervision-review-observation.js";
import { readSupervisionPeerFacts } from "./supervision-peer-facts.js";
import { readSupervisionHandoffState } from "./supervision-handoff-state.js";
import { readBoundSupervisionRequest } from "./supervision-bound-request.js";
import { observeSupervisionResearchPolicy } from "./supervision-research-policy.js";
import { readSupervisionResearchEvidence } from "./supervision-research-evidence.js";

type Source = Awaited<ReturnType<SupervisionTaskSource["read"]>>;

export class OwnerReasoningSourceChangedError extends Error {
  constructor() {
    super("An owner reasoning source changed before invocation.");
    this.name = "OwnerReasoningSourceChangedError";
  }
}

/** Semantic task basis excludes the reasoning run itself, retaining real task and role changes. */
export async function canonicalOwnerReasoningFacts(
  storage: ProjectStorage,
  binding: NodeSupervisionBinding,
  source: Source,
  now: () => string,
) {
  const { mandate } = await readInstalledNodeMandate(storage, binding, now);
  const roleIds = [
    ...new Set([...source.agents.map((agent) => agent.roleId), ...mandate.roleIds]),
  ].sort();
  const roles = await Promise.all(
    roleIds.map((roleId) => resolveRoleContract(storage.paths.repositoryRoot, roleId)),
  );
  const tasks = await observeSupervisionTasks(source, storage.artifacts, binding, storage.events);
  const researchEvidence = [];
  for (const assignment of source.assignments) {
    const role = roles.find((item) => item.roleId === assignment.roleId);
    if (
      assignment.status !== "leased" ||
      !role?.definition.profile.contextPolicy.requiredDocumentRuleIds.includes(
        "research.source-policy",
      )
    )
      continue;
    const task = tasks.assignments.find((item) => item.assignmentId === assignment.assignmentId);
    const responsibility = source.responsibilities.find(
      (item) => item.assignmentId === assignment.assignmentId,
    )?.binding?.responsibility;
    if (
      task?.terminalEventId === null ||
      task === undefined ||
      responsibility === undefined ||
      storage.events.get(task.terminalEventId)?.type !== "run.completed"
    )
      continue;
    researchEvidence.push(
      await readSupervisionResearchEvidence({
        storage,
        responsibility,
        terminalEventId: task.terminalEventId,
      }),
    );
  }
  const policy = await loadRepositoryKnowledgePolicy(storage.paths.repositoryRoot);
  const unstartedWorkspaces = [];
  for (const workspace of await listWorkspaces(storage.paths.repositoryRoot)) {
    const assignment = source.assignments.find(
      (item) => item.assignmentId === workspace.assignmentId,
    );
    if (assignment === undefined) continue;
    const proof = await observeUnstartedSupervisionWorkspace({
      repositoryRoot: storage.paths.repositoryRoot,
      binding,
      assignment,
      workspace,
      now,
      storage,
    });
    if (proof !== null) unstartedWorkspaces.push(proof);
  }
  const facts = {
    unstartedWorkspaces,
    researchEvidence,
    researchPolicy: roles.some((role) =>
      role.definition.profile.contextPolicy.requiredDocumentRuleIds.includes(
        "research.source-policy",
      ),
    )
      ? await observeSupervisionResearchPolicy(
          storage.paths.repositoryRoot,
          storage.manifest.projectId,
        )
      : null,
    writingContract: writingContractForLanguage(policy.publication.language),
    resultWritingContract,
    acceptedGoal: await readAcceptedSupervisionGoal(storage, source),
    boundRequest: await readBoundSupervisionRequest(storage, source, binding),
    mandate,
    workstream: source.workstream,
    agents: source.agents,
    assignments: source.assignments,
    responsibilities: source.responsibilities,
    graphHash: source.graph.graphHash,
    tasks,
    peers: await readSupervisionPeerFacts(
      source.events,
      storage.artifacts,
      binding,
      storage.manifest.projectId,
    ),
    handoffs: await readSupervisionHandoffState(
      {
        events: storage.events,
        artifacts: storage.artifacts,
        projectId: storage.manifest.projectId,
      },
      source,
      binding,
      now(),
    ),
    failureFeedback: await Promise.all(
      source.execution.attempts
        .filter(
          (attempt) =>
            attempt.assignmentId !== null &&
            source.events.some(
              (event) => event.runId === attempt.runId && event.type === "run.failed",
            ),
        )
        .map(async (attempt) => ({
          assignmentId: attempt.assignmentId,
          runId: attempt.runId,
          observation: await observeSupervisionFailure(
            source.events.filter((event) => event.runId === attempt.runId),
            storage.artifacts,
          ),
        })),
    ),
    reviewFeedback: await Promise.all(
      tasks.assignments
        .filter((item) => item.review?.eventId !== undefined)
        .map((item) =>
          readSupervisedReviewFeedback({
            events: storage.events,
            artifacts: storage.artifacts,
            authority: binding,
            candidate: storage.events.get(item.review!.eventId!) ?? undefined,
          }),
        ),
    ),
    roles: roles.map((role) => ({
      roleId: role.roleId,
      version: role.version,
      contractHash: role.contractHash,
      profile: role.definition.profile,
      evaluation: role.definition.evaluation,
    })),
  };
  return { facts, basisHash: operatingContractHash({ ...binding, ...facts }) };
}

export interface OwnerReasoningContext {
  schemaVersion: 1;
  kind: "work.owner_reasoning.context";
  basisHash: string;
  facts: Awaited<ReturnType<typeof canonicalOwnerReasoningFacts>>["facts"];
  trigger: { reasonCode: string; nextAction: string; assignmentIds: string[] };
  planning: Awaited<ReturnType<typeof loadSupervisionPlanningContext>>;
  results: { contentHash: string; text: string }[];
}

export async function createOwnerReasoningContext(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  source: Source;
  report: OutcomeSupervisionReportV1;
  expectedPaths: string[];
  now(): string;
}) {
  const { facts, basisHash } = await canonicalOwnerReasoningFacts(
    input.storage,
    input.binding,
    input.source,
    input.now,
  );
  if (input.report.nextAction === null)
    throw new Error("An idle owner requires no reasoning call.");
  const planning = await loadSupervisionPlanningContext({
    repositoryRoot: input.storage.paths.repositoryRoot,
    projectId: input.storage.manifest.projectId,
    workstreamId: input.binding.workstreamId,
    workstreamRevision: input.source.workstream.revision,
    workstreamStatus: input.report.nextAction === "publish_result" ? "completed" : "active",
    purpose: input.source.workstream.objective,
    expectedPaths: input.expectedPaths,
    now: input.now,
  });
  const hashes = [
    ...new Set(facts.tasks.assignments.flatMap((assignment) => assignment.artifactHashes)),
  ].sort();
  if (hashes.length > 32) throw new Error("The owner review exceeds its artifact bound.");
  const results = await Promise.all(
    hashes.map(async (contentHash) => ({
      contentHash,
      text: await readSupervisionTextArtifact(input.storage.artifacts, contentHash),
    })),
  );
  const context: OwnerReasoningContext = {
    schemaVersion: 1,
    kind: "work.owner_reasoning.context",
    basisHash,
    facts,
    trigger: {
      reasonCode: input.report.reasonCode,
      nextAction: input.report.nextAction,
      assignmentIds: [...input.report.assignmentIds],
    },
    planning,
    results,
  };
  const content = canonicalJson(context);
  if (Buffer.byteLength(content) > 256 * 1024)
    throw new Error("Owner reasoning context exceeds its byte bound.");
  const artifact = await input.storage.artifacts.put(content);
  return { context, artifact };
}

export async function assertOwnerReasoningContext(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  source: Source;
  context: OwnerReasoningContext;
  basisHash: string;
  now(): string;
}) {
  const { context } = input;
  const current = await canonicalOwnerReasoningFacts(
    input.storage,
    input.binding,
    input.source,
    input.now,
  );
  if (
    Object.keys(context).length !== 7 ||
    context.schemaVersion !== 1 ||
    context.kind !== "work.owner_reasoning.context" ||
    context.basisHash !== input.basisHash ||
    current.basisHash !== input.basisHash ||
    operatingContractHash(current.facts) !== operatingContractHash(context.facts) ||
    operatingContractHash(context.planning.workstream) !==
      operatingContractHash(input.source.workstream) ||
    !Array.isArray(context.planning.sources) ||
    context.planning.sources.length > 64 ||
    !Array.isArray(context.results) ||
    context.results.length > 32
  )
    throw new Error("The owner reasoning context differs from canonical task facts.");
  for (const source of context.planning.sources) {
    if (
      typeof source.text !== "string" ||
      `sha256:${createHash("sha256").update(source.text).digest("hex")}` !== source.contentHash
    )
      throw new Error("The stored owner reasoning source text differs from its recorded hash.");
    const bytes = await readRepositoryFile(input.storage.paths.repositoryRoot, source.path, 131072);
    if (
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== source.contentHash ||
      new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== source.text
    )
      throw new OwnerReasoningSourceChangedError();
  }
  const hashes = [
    ...new Set(current.facts.tasks.assignments.flatMap((assignment) => assignment.artifactHashes)),
  ].sort();
  if (
    operatingContractHash(context.results.map((result) => result.contentHash).sort()) !==
    operatingContractHash(hashes)
  )
    throw new Error("Owner reasoning omitted or substituted current result evidence.");
  for (const result of context.results)
    if (
      (await readSupervisionTextArtifact(input.storage.artifacts, result.contentHash)) !==
      result.text
    )
      throw new Error("An owner reasoning result differs from canonical artifact bytes.");
}
