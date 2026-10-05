import type {
  KnowledgeConvergenceOwnerAttentionItemV1,
  KnowledgePublicationAttentionItemV1,
  OperatingAttentionItemV1,
} from "@lervo/application-contract";
import {
  readConvergenceOwnerFence,
  readKnowledgePublicationState,
} from "@lervo/repository-knowledge-runtime";

/** ADR-0466 private state the attention projection reads; absent files mean nothing to report. */
export interface KnowledgeConvergenceAttentionInput {
  owner: Awaited<ReturnType<typeof readConvergenceOwnerFence>>;
  publication: Awaited<ReturnType<typeof readKnowledgePublicationState>>;
}

export async function readKnowledgeConvergenceAttention(
  root: string,
): Promise<KnowledgeConvergenceAttentionInput> {
  const [owner, publication] = await Promise.all([
    readConvergenceOwnerFence(root),
    readKnowledgePublicationState(root),
  ]);
  return { owner, publication };
}

const PUBLICATION_INSTRUCTIONS: Record<string, string> = {
  knowledge_publication_fetch_failed:
    "Check that this host can fetch the configured remote with its own Git credentials, then run lervo knowledge convergence owner publish.",
  knowledge_publication_push_failed:
    "Check that this host can push the publication branch, and that no one else moved it, then run lervo knowledge convergence owner publish.",
  knowledge_publication_scope_violation:
    "A Lervo Knowledge commit changes a path outside the allowed publication roots. Inspect it with git log --author=knowledge@lervo.invalid and move or revert it; nothing was published.",
  knowledge_publication_conflict:
    "The knowledge commits do not apply cleanly to the remote base branch. Pull or rebase the local base branch, then run lervo knowledge convergence owner publish.",
  knowledge_publication_pull_request_failed:
    "Check that gh is installed and authenticated on this host, then run lervo knowledge convergence owner publish.",
  knowledge_publication_checks_failed:
    "A required check failed on the knowledge publication pull request. Inspect its CI result; the publisher will not merge until every check passes.",
  knowledge_publication_merge_failed:
    "Merging the knowledge publication pull request failed. Inspect the pull request and merge or close it.",
};

/** At most one ownership item and one publication item. */
export function knowledgeConvergenceAttentionItems(
  input: KnowledgeConvergenceAttentionInput,
): OperatingAttentionItemV1[] {
  const items: OperatingAttentionItemV1[] = [];
  const verdict = input.owner?.verdict;
  if (verdict !== undefined && (verdict.role === "unverifiable" || verdict.role === "contended")) {
    const item: KnowledgeConvergenceOwnerAttentionItemV1 = {
      schemaVersion: 1,
      kind: "knowledge_convergence_owner",
      itemId: `knowledge_convergence_owner_${verdict.role}`,
      state: "action_required",
      role: verdict.role,
      reason: verdict.reason,
      holderLabel: verdict.holder?.label ?? null,
      observedAt: verdict.observedAt,
      actionOwner: "user",
      requiresUserAction: true,
      blocking: false,
      instruction:
        verdict.role === "contended"
          ? "Two hosts commit background knowledge for this repository. Configure both in hub mode with one Hub; see the cross-host ownership specification."
          : "This host cannot prove it owns background knowledge convergence. Check its Hub configuration and reachability with lervo knowledge convergence owner status.",
    };
    items.push(item);
  }
  const failure = input.publication?.status === "failed" ? input.publication.failure : null;
  if (failure !== null && failure !== undefined) {
    const item: KnowledgePublicationAttentionItemV1 = {
      schemaVersion: 1,
      kind: "knowledge_publication",
      itemId: `knowledge_publication_${failure.code}`,
      state: "action_required",
      failureCode: failure.code,
      detail: failure.detail,
      pullRequestUrl: input.publication?.pullRequestUrl ?? null,
      occurrences: failure.occurrences,
      firstObservedAt: failure.firstObservedAt,
      actionOwner: "user",
      requiresUserAction: true,
      blocking: false,
      instruction:
        PUBLICATION_INSTRUCTIONS[failure.code] ??
        "Inspect lervo knowledge convergence owner status and retry the publication.",
    };
    items.push(item);
  }
  return items;
}
