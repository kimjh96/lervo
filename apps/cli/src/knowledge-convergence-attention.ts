import type {
  KnowledgeConvergenceOwnerAttentionItemV1,
  KnowledgePublicationAttentionItemV1,
  OperatingAttentionItemV1,
} from "@lervo/application-contract";
import {
  readConvergenceOwnerFence,
  readConvergenceOwnerHost,
  readKnowledgePublicationState,
} from "@lervo/repository-knowledge-runtime";

import {
  convergenceOwnerRemediation,
  type ConvergenceOwnerHubScope,
} from "./knowledge-convergence-owner-remediation.js";

/** ADR-0466 private state the attention projection reads; absent files mean nothing to report. */
export interface KnowledgeConvergenceAttentionInput {
  owner: Awaited<ReturnType<typeof readConvergenceOwnerFence>>;
  publication: Awaited<ReturnType<typeof readKnowledgePublicationState>>;
  /** The Hub scope an ownership remediation names; absent or null outside hub mode. */
  hubScope?: ConvergenceOwnerHubScope | null;
}

/** Reads the Hub destination of a Hub-mode host; any other host has no Hub scope. */
async function readConvergenceOwnerHubScope(
  root: string,
  projectId: string,
): Promise<ConvergenceOwnerHubScope | null> {
  const host = await readConvergenceOwnerHost(root).catch(() => null);
  return host?.config.coordination.mode === "hub"
    ? { projectId, destinationId: host.config.coordination.hub.destinationId }
    : null;
}

export async function readKnowledgeConvergenceAttention(
  root: string,
  projectId: string,
): Promise<KnowledgeConvergenceAttentionInput> {
  const [owner, publication, hubScope] = await Promise.all([
    readConvergenceOwnerFence(root),
    readKnowledgePublicationState(root),
    readConvergenceOwnerHubScope(root, projectId),
  ]);
  return { owner, publication, hubScope };
}

const PUBLICATION_INSTRUCTIONS: Record<string, string> = {
  knowledge_publication_fetch_failed:
    "Check that this host can fetch the configured remote with its own Git credentials, then run lervo knowledge convergence owner publish.",
  knowledge_publication_push_failed:
    "Check that this host can push the publication branch, and that no one else moved it, then run lervo knowledge convergence owner publish.",
  knowledge_publication_scope_violation:
    "A Lervo Knowledge commit changes a path outside the allowed publication roots. Inspect it with git log --author=knowledge@lervo.invalid and move or revert it; nothing was published.",
  knowledge_publication_conflict:
    "Replaying the knowledge commits onto the remote base branch failed for a reason other than a content conflict. Check the host's Git installation and temporary directory, then run lervo knowledge convergence owner publish.",
  knowledge_publication_superseded:
    "The knowledge commits were computed against an older base and conflict with the current remote base, so they were not published; a backup ref keeps them. When the local base branch was reset, convergence regenerates the outputs on its next cycle and nothing else is needed. Otherwise rebase the local base branch onto the remote base, then run lervo knowledge convergence owner publish.",
  knowledge_publication_pull_request_failed:
    "Check that gh is installed and authenticated on this host, then run lervo knowledge convergence owner publish.",
  knowledge_publication_checks_failed:
    "A check on the knowledge publication pull request finished without success, for example failed, cancelled, or neutral. Inspect its CI result; the publisher will not merge until every check succeeds.",
  knowledge_publication_merge_failed:
    "Merging the knowledge publication pull request failed. Inspect the pull request and merge or close it.",
};

/** Remediations for the forge failure class a `gh <step> exit <code> <class>` detail names. */
const FORGE_FAILURE_INSTRUCTIONS: Record<string, string> = {
  auth: "The gh CLI on this host is not authenticated for this repository or lacks write access. Run gh auth status, log in with an account that can push and merge, then run lervo knowledge convergence owner publish.",
  network:
    "The gh CLI on this host could not reach GitHub in time. Check the host's network and GitHub status; the next resident cycle retries.",
  not_installed:
    "The gh CLI is not installed or not on the resident's PATH on this host. Install it, log in, then run lervo knowledge convergence owner publish.",
  not_mergeable:
    "GitHub refused to merge the knowledge publication pull request because it is not mergeable at the published head. Inspect the pull request for conflicts or a branch policy, then merge or close it.",
  not_found:
    "GitHub could not find the knowledge publication pull request or repository. Check the host's gh repository context, then run lervo knowledge convergence owner publish.",
};

function forgeFailureInstruction(detail: string | null): string | undefined {
  const failureClass = detail === null ? undefined : /^gh \S+ exit \S+ (\S+)$/u.exec(detail)?.[1];
  return failureClass === undefined ? undefined : FORGE_FAILURE_INSTRUCTIONS[failureClass];
}

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
      failureCode: verdict.failureCode ?? null,
      httpStatus: verdict.httpStatus ?? null,
      holderLabel: verdict.holder?.label ?? null,
      observedAt: verdict.observedAt,
      actionOwner: "user",
      requiresUserAction: true,
      blocking: false,
      instruction: convergenceOwnerRemediation(verdict, input.hubScope ?? null)!,
    };
    items.push(item);
  }
  const failure =
    input.publication?.status === "failed" || input.publication?.status === "superseded"
      ? input.publication.failure
      : null;
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
        forgeFailureInstruction(failure.detail) ??
        PUBLICATION_INSTRUCTIONS[failure.code] ??
        "Inspect lervo knowledge convergence owner status and retry the publication.",
    };
    items.push(item);
  }
  return items;
}
