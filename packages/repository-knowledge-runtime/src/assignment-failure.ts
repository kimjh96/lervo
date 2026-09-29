import {
  completeAssignment,
  reopenAssignment,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { recordConvergenceWorkforceEvent } from "./workforce-event.js";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { operatingContractHash } from "@lervo/work-controller";

/** Failure bookkeeping returns only the exact lease; it grants no source-write authority. */
export async function failConvergenceAssignment(input: {
  storage: ProjectStorage;
  assignment: WorkforceAssignment;
  error: unknown;
  state: KnowledgeConvergenceInput;
  assertLease(): void;
}): Promise<void> {
  const { assignment, storage } = input;
  input.assertLease();
  const raw = (input.error as { code?: unknown } | null)?.code;
  const code =
    typeof raw === "string" && /^[a-z][a-z0-9_]{1,99}$/u.test(raw)
      ? raw
      : "knowledge_job_transient_failure";
  const proof = await storage.artifacts.put(
    canonicalJson({
      schemaVersion: 1,
      kind: "convergence_assignment_failure",
      assignmentId: assignment.assignmentId,
      assignmentHash: operatingContractHash(assignment),
      input: input.state,
      inputArtifactHash: assignment.convergence!.inputArtifactHash,
      leaseId: assignment.lease!.leaseId,
      leaseGeneration: assignment.lease!.generation,
      code,
      evidenceHash: /^sha256:[a-f0-9]{64}$/u.test(
        String((input.error as { dependencyHash?: unknown } | null)?.dependencyHash),
      )
        ? (input.error as { dependencyHash: string }).dependencyHash
        : null,
      returnedAt: new Date().toISOString(),
      message: input.error instanceof Error ? input.error.message.slice(0, 8192) : null,
    }),
  );
  input.assertLease();
  await completeAssignment({
    repositoryRoot: storage.paths.repositoryRoot,
    assignmentId: assignment.assignmentId,
    agentId: assignment.lease!.agentId,
    leaseId: assignment.lease!.leaseId,
    verificationStatus: "failed",
    failureCode: code,
    resultArtifacts: [
      { artifactId: `art_${proof.contentHash.slice(7, 39)}`, contentHash: proof.contentHash },
    ],
    recordEvent: (event) => recordConvergenceWorkforceEvent(storage, event),
  });
  if (input.error instanceof Error)
    Object.assign(input.error, { dependencyHash: proof.contentHash });
}

/** The owner calls this only after source, delegation and any stopped dependency are current. */
export async function retryConvergenceAssignment(
  storage: ProjectStorage,
  assignment: WorkforceAssignment,
): Promise<WorkforceAssignment> {
  if (assignment.status !== "failed" || assignment.convergence == null || assignment.lease !== null)
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  if ((assignment.recovery?.attemptNumber ?? 1) >= 16)
    throw new KnowledgeConvergenceRuntimeError("knowledge_retry_exhausted");
  const artifact = assignment.resultArtifacts[0];
  if (!artifact) throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  const bytes = await storage.artifacts.get(`lervo-cas://sha256/${artifact.contentHash.slice(7)}`);
  if (sha256(bytes) !== artifact.contentHash)
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  let afterSeq = 0;
  let terminal: ReturnType<typeof storage.events.get> = null;
  for (;;) {
    const page = storage.events.list({ afterSeq, limit: 512 });
    if (!page.length) break;
    for (const event of page)
      if (
        event.type === "assignment.completed" &&
        event.payload.assignmentId === assignment.assignmentId &&
        event.payload.status === "failed" &&
        event.occurredAt === assignment.updatedAt &&
        Array.isArray(event.payload.artifactHashes) &&
        event.payload.artifactHashes.includes(artifact.contentHash)
      )
        terminal = event;
    afterSeq = page.at(-1)!.seq;
  }
  if (!terminal) throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  return reopenAssignment({
    repositoryRoot: storage.paths.repositoryRoot,
    assignmentId: assignment.assignmentId,
    now: new Date(),
    recovery: {
      kind: "retry",
      predecessorAssignmentHash: operatingContractHash(assignment),
      responsibilityHash: operatingContractHash(assignment.convergence),
      sourceRunId: terminal.runId,
      terminalEventId: terminal.eventId,
      reviewEventId: null,
      predecessorLeaseGeneration: assignment.lastLeaseGeneration!,
      attemptNumber: (assignment.recovery?.attemptNumber ?? 1) + 1,
    },
    recordEvent: (event) => recordConvergenceWorkforceEvent(storage, event),
  });
}
