import { createHash } from "node:crypto";

import { assertReadOnlyKnowledgeReviewAuthority } from "@lervo/agent-workforce";
import { readRepositoryFile } from "@lervo/context";
import type { OutboxDelivery, OutboxStore, ArtifactStore } from "@lervo/storage-contract";

import { conversationKnowledgeAssignmentProvenance } from "./conversation-knowledge-assignment-provenance.js";
import {
  ConversationKnowledgeLeaseError,
  readLeasedConversationKnowledgeJob,
  type LeasedConversationKnowledgeJob,
} from "./conversation-knowledge-lease.js";
import {
  ConversationKnowledgeReviewContextError,
  loadConversationKnowledgeReviewContext,
} from "./conversation-knowledge-review-context.js";
import {
  captureLeasedConversationKnowledgeReviewSource,
  type LeasedConversationKnowledgeReviewSource,
} from "./conversation-knowledge-review-source.js";
import {
  runConversationKnowledgeSemanticReview,
  type SemanticReviewCandidate,
} from "./conversation-knowledge-semantic-review.js";
import type { SemanticReviewContextDocument } from "./conversation-knowledge-semantic-review.js";
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
        | ConversationKnowledgeReviewContextError["code"];
    };

async function contextIsCurrent(
  repositoryRoot: string,
  documents: SemanticReviewContextDocument[],
): Promise<boolean> {
  for (const document of documents) {
    const content = await readRepositoryFile(repositoryRoot, document.path, 128 * 1024);
    if (`sha256:${createHash("sha256").update(content).digest("hex")}` !== document.contentHash)
      return false;
  }
  return true;
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
  const provenance = conversationKnowledgeAssignmentProvenance({
    job: source.job,
    agentId: input.agentId,
  });
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
  let contextDocuments: SemanticReviewContextDocument[];
  try {
    contextDocuments = await loadConversationKnowledgeReviewContext({
      repositoryRoot: input.repositoryRoot,
      sourcePaths,
    });
  } catch (error) {
    if (!(error instanceof ConversationKnowledgeReviewContextError)) throw error;
    return {
      status: "needs_review",
      job: source.job,
      changedPathCount: sourcePaths.length,
      reasonCode: error.code,
    };
  }
  let contextCurrent: boolean;
  try {
    contextCurrent = await contextIsCurrent(input.repositoryRoot, contextDocuments);
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
  const jobBeforeProvider = await revalidateAuthority();
  const currencyBeforeProvider = await inspectRepositoryWorkSourceCurrency({
    repositoryRoot: input.repositoryRoot,
    manifest: source.manifest,
  });
  if (currencyBeforeProvider.status !== "ready_for_review")
    return { ...currencyBeforeProvider, job: jobBeforeProvider };

  let review: SemanticReviewCandidate | undefined;
  let failure: unknown;
  try {
    review = await runConversationKnowledgeSemanticReview({
      provider: input.provider,
      snapshot: source.snapshot,
      contextDocuments,
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
    contextCurrent = await contextIsCurrent(input.repositoryRoot, contextDocuments);
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
