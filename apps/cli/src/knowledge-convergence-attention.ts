import type {
  KnowledgeConvergenceOwnerAttentionItemV1,
  KnowledgePublicationAttentionItemV1,
  OperatingAttentionItemV1,
} from "@lervo/application-contract";
import {
  defaultConvergenceContinuityPolicyPath,
  inspectConvergenceContinuity,
  readConvergenceOwnerFence,
  readConvergenceOwnerHost,
  readKnowledgePublicationState,
  readKnowledgeSupersessionLedger,
} from "@lervo/repository-knowledge-runtime";

import {
  convergenceOwnerRemediation,
  type ConvergenceOwnerHubScope,
} from "./knowledge-convergence-owner-remediation.js";
import { continuityAttentionItems } from "./knowledge-continuity-attention.js";

/** ADR-0466 private state the attention projection reads; absent files mean nothing to report. */
export interface KnowledgeConvergenceAttentionInput {
  owner: Awaited<ReturnType<typeof readConvergenceOwnerFence>>;
  publication: Awaited<ReturnType<typeof readKnowledgePublicationState>>;
  /** Superseded knowledge commits this checkout could not drop; absent means none. */
  supersession?: Awaited<ReturnType<typeof readKnowledgeSupersessionLedger>>;
  /** The Hub scope an ownership remediation names; absent or null outside hub mode. */
  hubScope?: ConvergenceOwnerHubScope | null;
  /** ADR-0469 continuity findings of this checkout; absent means none were inspected. */
  continuity?: Awaited<ReturnType<typeof inspectConvergenceContinuity>> | null;
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
  const [owner, publication, hubScope, supersession, continuity] = await Promise.all([
    readConvergenceOwnerFence(root),
    readKnowledgePublicationState(root),
    readConvergenceOwnerHubScope(root, projectId),
    readKnowledgeSupersessionLedger(root),
    inspectConvergenceContinuity({
      repositoryRoot: root,
      policyPath: defaultConvergenceContinuityPolicyPath(),
    }).catch(() => null),
  ]);
  return { owner, publication, hubScope, supersession, continuity };
}

const PUBLICATION_INSTRUCTIONS: Record<string, string> = {
  knowledge_publication_fetch_failed:
    "Check that this host can fetch the configured remote with its own Git credentials, then run lervo knowledge convergence owner publish.",
  knowledge_publication_push_failed:
    "Check that this host can push the publication branch, and that no one else moved it, then run lervo knowledge convergence owner publish.",
  knowledge_publication_scope_violation:
    "A Lervo Knowledge commit changes a path outside the knowledge write scope or a document a repository tool generates, and the owner could not restore it automatically; nothing was published. The detail names what blocked the repair: commit or discard uncommitted edits to those paths (uncommitted_change), or, when a developer commit also changed them (developer_change), restore them by hand in a commit of your own. The next resident cycle repairs and publishes the rest.",
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

/** Remediations for each reason superseded knowledge commits stayed on the branch. */
const SUPERSESSION_HELD_INSTRUCTIONS: Record<string, string> = {
  not_on_branch:
    "Superseded Lervo Knowledge commits remain because HEAD is detached or a Git operation is in progress. Finish or abort the operation and check out the branch; the next replica cycle drops them.",
  under_other_work:
    "Superseded Lervo Knowledge commits sit below other commits on this branch, so they were not removed automatically and replication waits. Rebase the branch onto the remote base and drop the commits authored by knowledge@lervo.invalid that git log lists before your own work; a backup ref under refs/lervo/knowledge-superseded keeps them.",
  worktree_conflict:
    "Superseded Lervo Knowledge commits remain because uncommitted edits touch the same paths. Commit or stash those edits; the next replica cycle drops the commits.",
};

function forgeFailureInstruction(detail: string | null): string | undefined {
  const failureClass = detail === null ? undefined : /^gh \S+ exit \S+ (\S+)$/u.exec(detail)?.[1];
  return failureClass === undefined ? undefined : FORGE_FAILURE_INSTRUCTIONS[failureClass];
}

/**
 * At most one ownership item, one publication item, one held-supersession item, and the bounded
 * ADR-0469 continuity items.
 */
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
  const held = input.supersession?.held ?? null;
  if (held !== null) {
    const item: KnowledgePublicationAttentionItemV1 = {
      schemaVersion: 1,
      kind: "knowledge_publication",
      itemId: "knowledge_publication_knowledge_supersession_held",
      state: "action_required",
      failureCode: "knowledge_supersession_held",
      detail: `${held.commitCount} superseded commit(s) held: ${held.reason}`,
      pullRequestUrl: null,
      occurrences: 1,
      firstObservedAt: held.observedAt,
      actionOwner: "user",
      requiresUserAction: true,
      blocking: false,
      instruction: SUPERSESSION_HELD_INSTRUCTIONS[held.reason]!,
    };
    items.push(item);
  }
  items.push(
    ...continuityAttentionItems(
      input.continuity?.findings ?? [],
      input.continuity?.state?.observedAt ?? null,
    ),
  );
  return items;
}
