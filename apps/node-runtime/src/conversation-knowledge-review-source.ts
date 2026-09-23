import {
  readLeasedConversationKnowledgeJob,
  type LeasedConversationKnowledgeJob,
} from "./conversation-knowledge-lease.js";
import {
  inspectLeasedConversationKnowledgeSource,
  type LeasedConversationKnowledgeSource,
} from "./conversation-knowledge-source-preflight.js";
import {
  readRepositoryWorkReviewSnapshot,
  type RepositoryWorkReviewSnapshot,
} from "./repository-work-review-snapshot.js";

export type LeasedConversationKnowledgeReviewSource =
  | {
      status: "ready_for_review";
      job: LeasedConversationKnowledgeJob;
      snapshot: Extract<RepositoryWorkReviewSnapshot, { status: "ready_for_review" }>;
    }
  | Extract<LeasedConversationKnowledgeSource, { status: "stale" | "needs_review" }>
  | (Extract<RepositoryWorkReviewSnapshot, { status: "stale" | "needs_review" }> & {
      job: LeasedConversationKnowledgeJob;
    });

/** Keeps exact source bytes private and re-fences the job after capture; no review or write is claimed. */
export async function captureLeasedConversationKnowledgeReviewSource(
  input: Parameters<typeof inspectLeasedConversationKnowledgeSource>[0] & {
    maximumBytes?: number;
  },
): Promise<LeasedConversationKnowledgeReviewSource> {
  const preflight = await inspectLeasedConversationKnowledgeSource(input);
  if (preflight.status !== "ready_for_review") return preflight;
  let snapshot: RepositoryWorkReviewSnapshot;
  try {
    snapshot = await readRepositoryWorkReviewSnapshot({
      repositoryRoot: input.repositoryRoot,
      manifest: preflight.manifest,
      ...(input.maximumBytes === undefined ? {} : { maximumBytes: input.maximumBytes }),
    });
  } catch (error) {
    readLeasedConversationKnowledgeJob({ ...input, now: input.now() });
    throw error;
  }
  const job = readLeasedConversationKnowledgeJob({ ...input, now: input.now() });
  return snapshot.status === "ready_for_review"
    ? { status: "ready_for_review", job, snapshot }
    : { ...snapshot, job };
}
