import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

import {
  assertReadOnlyKnowledgeReviewAuthority,
  type WorkforceAssignmentKnowledgeJobProvenance,
} from "@lervo/agent-workforce";
import type { OutboxDelivery, OutboxStore, ArtifactStore } from "@lervo/storage-contract";

import {
  ConversationKnowledgeLeaseError,
  readLeasedConversationKnowledgeJob,
  type LeasedConversationKnowledgeJob,
} from "./conversation-knowledge-lease.js";
import {
  captureLeasedConversationKnowledgeReviewSource,
  type LeasedConversationKnowledgeReviewSource,
} from "./conversation-knowledge-review-source.js";
import {
  runConversationKnowledgeSemanticReview,
  type SemanticReviewCandidate,
  type SemanticReviewContextDocument,
} from "./conversation-knowledge-semantic-review.js";
import {
  inspectRepositoryWorkSourceCurrency,
  type RepositoryWorkSourceCurrency,
} from "./repository-work-source-currency.js";

export type LeasedKnowledgeSemanticReviewResult =
  | { status: "candidate"; job: LeasedConversationKnowledgeJob; review: SemanticReviewCandidate }
  | {
      status: "stale" | "needs_review";
      job: LeasedConversationKnowledgeJob;
      changedPathCount: number;
      reasonCode:
        | Extract<
            LeasedConversationKnowledgeReviewSource,
            { status: "stale" | "needs_review" }
          >["reasonCode"]
        | Exclude<RepositoryWorkSourceCurrency, { status: "ready_for_review" }>["reasonCode"]
        | "review_context_stale";
    };

async function contextIsCurrent(
  repositoryRoot: string,
  documents: SemanticReviewContextDocument[],
): Promise<boolean> {
  const root = await realpath(repositoryRoot);
  for (const document of documents) {
    const path = resolve(root, document.path);
    if (
      !path.startsWith(`${root}${sep}`) ||
      (await realpath(path)) !== path ||
      !(await lstat(path)).isFile()
    )
      return false;
    const content = await readFile(path);
    if (`sha256:${createHash("sha256").update(content).digest("hex")}` !== document.contentHash)
      return false;
  }
  return true;
}

function knowledgeJobProvenance(input: {
  job: LeasedConversationKnowledgeJob;
  agentId: string;
}): WorkforceAssignmentKnowledgeJobProvenance {
  const { completion, jobId } = input.job;
  const sourceConversationEventId = completion.payload.sourceConversationEventId;
  const sourceManifestHash = completion.payload.sourceManifestContentHash;
  if (
    completion.schemaVersion !== 3 ||
    completion.payload.knowledgeDisposition !== "pending_background" ||
    typeof sourceConversationEventId !== "string" ||
    typeof sourceManifestHash !== "string"
  )
    throw new ConversationKnowledgeLeaseError(
      "knowledge_job_completion_invalid",
      "The review source does not match a source-bound completion.",
    );
  return {
    contractVersion: 1,
    jobId,
    completionEventId: completion.eventId,
    completionEventHash: completion.eventHash,
    sourceConversationEventId,
    sourceManifestHash,
    agentId: input.agentId,
  };
}

/** No provider sees source bytes until both the exact outbox lease and read-only agent lease pass. */
export async function runLeasedConversationKnowledgeReview(input: {
  events: Pick<OutboxStore, "get" | "getOutbox">;
  artifacts: ArtifactStore;
  repositoryRoot: string;
  claimed: OutboxDelivery;
  workerId: string;
  now(): string;
  assignmentId: string;
  agentId: string;
  assignmentLeaseId: string;
  provider: "codex" | "claude";
  verificationSuiteIds: string[];
  contextDocuments: SemanticReviewContextDocument[];
  maximumBytes?: number;
  model?: string;
  executable?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  openRunner?: typeof import("@lervo/repository-knowledge-compiler").createNoCapabilityProviderJsonRunner;
}): Promise<LeasedKnowledgeSemanticReviewResult> {
  const source = await captureLeasedConversationKnowledgeReviewSource(input);
  if (source.status !== "ready_for_review") return source;
  const sourcePaths = source.snapshot.paths.map((item) => item.path);
  const provenance = knowledgeJobProvenance({ job: source.job, agentId: input.agentId });
  const revalidateAuthority = async () => {
    const job = readLeasedConversationKnowledgeJob({ ...input, now: input.now() });
    if (
      job.jobId !== source.job.jobId ||
      job.completion.eventHash !== source.job.completion.eventHash
    )
      throw new ConversationKnowledgeLeaseError(
        "knowledge_job_lease_conflict",
        "The review job changed during source-bound work.",
      );
    await assertReadOnlyKnowledgeReviewAuthority({
      repositoryRoot: input.repositoryRoot,
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      leaseId: input.assignmentLeaseId,
      provider: input.provider,
      sourcePaths,
      verificationSuiteIds: input.verificationSuiteIds,
      knowledgeJob: provenance,
      now: new Date(input.now()),
    });
    return job;
  };
  await revalidateAuthority();
  const firstCurrency = await inspectRepositoryWorkSourceCurrency({
    repositoryRoot: input.repositoryRoot,
    manifest: source.manifest,
  });
  if (firstCurrency.status !== "ready_for_review") return { ...firstCurrency, job: source.job };
  let contextCurrent: boolean;
  try {
    contextCurrent = await contextIsCurrent(input.repositoryRoot, input.contextDocuments);
  } catch {
    contextCurrent = false;
  }
  if (!contextCurrent)
    return {
      status: "needs_review",
      job: source.job,
      changedPathCount: sourcePaths.length,
      reasonCode: "review_context_stale",
    };

  let review: SemanticReviewCandidate | undefined;
  let failure: unknown;
  try {
    review = await runConversationKnowledgeSemanticReview({
      provider: input.provider,
      snapshot: source.snapshot,
      contextDocuments: input.contextDocuments,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.executable === undefined ? {} : { executable: input.executable }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.openRunner === undefined ? {} : { openRunner: input.openRunner }),
    });
  } catch (error) {
    failure = error;
  }
  const job = await revalidateAuthority();
  const currency: RepositoryWorkSourceCurrency = await inspectRepositoryWorkSourceCurrency({
    repositoryRoot: input.repositoryRoot,
    manifest: source.manifest,
  });
  if (currency.status !== "ready_for_review") return { ...currency, job };
  try {
    contextCurrent = await contextIsCurrent(input.repositoryRoot, input.contextDocuments);
  } catch {
    contextCurrent = false;
  }
  if (!contextCurrent)
    return {
      status: "needs_review",
      job,
      changedPathCount: sourcePaths.length,
      reasonCode: "review_context_stale",
    };
  if (failure !== undefined) throw failure;
  return { status: "candidate", job, review: review! };
}
