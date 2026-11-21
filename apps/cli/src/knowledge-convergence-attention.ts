import type {
  KnowledgeConvergenceOwnerAttentionItemV1,
  KnowledgePublicationAttentionItemV1,
  OperatingAttentionItemV1,
} from "@lervo/application-contract";
import {
  defaultConvergenceContinuityPolicyPath,
  inspectConvergenceContinuity,
  readConvergenceOwnerFence,
  knowledgePublicationWaitExhausted,
  readConvergenceOwnerHost,
  readKnowledgePublicationAcknowledged,
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
  /** ADR-0603: publication attention the owner acknowledged; absent means none. */
  publicationAcknowledged?: Awaited<ReturnType<typeof readKnowledgePublicationAcknowledged>>;
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
  const [owner, publication, publicationAcknowledged, hubScope, supersession, continuity] =
    await Promise.all([
      readConvergenceOwnerFence(root),
      readKnowledgePublicationState(root),
      readKnowledgePublicationAcknowledged(root),
      readConvergenceOwnerHubScope(root, projectId),
      readKnowledgeSupersessionLedger(root),
      inspectConvergenceContinuity({
        repositoryRoot: root,
        policyPath: defaultConvergenceContinuityPolicyPath(),
      }).catch(() => null),
    ]);
  return { owner, publication, publicationAcknowledged, hubScope, supersession, continuity };
}

const PUBLICATION_INSTRUCTIONS: Record<string, string> = {
  knowledge_publication_fetch_failed:
    "Check that this host can fetch the configured remote with its own Git credentials, then run lervo knowledge convergence owner publish.",
  knowledge_publication_inspect_failed:
    "Reading this checkout's own Git history to match knowledge commits with merged pull requests failed. Check the repository with git fsck and that the host has room in its temporary directory; the next cycle tries again.",
  knowledge_publication_pull_head_unavailable:
    "GitHub does not serve the head of a merged knowledge publication pull request (refs/pull/<n>/head), so Lervo cannot prove which commits it carried and publishes nothing until it can. It tries again after 2 minutes, doubling to an hour, then on the next cycle that runs for another reason. Check the pull request named in the detail on GitHub; if its head is gone for good, push its commits' content to the base yourself or ask GitHub support.",
  knowledge_publication_push_failed:
    "Check that this host can push the publication branch, and that no one else moved it, then run lervo knowledge convergence owner publish. A detail ending in rule_refusal means a ruleset or branch protection refused the push: exempt the publication branch from rules that forbid force pushes, creation or unsigned commits.",
  knowledge_publication_scope_violation:
    "A Lervo Knowledge commit changes a path outside the knowledge write scope or a document a repository tool generates, and the owner could not restore it automatically; nothing was published. The detail names what blocked the repair: commit or discard uncommitted edits to those paths (uncommitted_change), or, when a developer commit also changed them (developer_change), restore them by hand in a commit of your own. The next resident cycle repairs and publishes the rest.",
  knowledge_publication_conflict:
    "Replaying the knowledge commits onto the remote base branch failed for a reason other than a content conflict. Check the host's Git installation and temporary directory, then run lervo knowledge convergence owner publish.",
  knowledge_publication_superseded:
    "The knowledge commits were computed against an older base and conflict with the current remote base, so they were not published; a backup ref keeps them. When the local base branch was reset, convergence regenerates the outputs on its next cycle and nothing else is needed. Otherwise rebase the local base branch onto the remote base, then run lervo knowledge convergence owner publish.",
  knowledge_publication_pull_request_failed:
    "Check that gh is installed and authenticated on this host, then run lervo knowledge convergence owner publish.",
  knowledge_publication_checks_failed:
    "A check on the knowledge publication pull request finished without success; the detail names each failed check and its conclusion. The publisher starts Actions jobs that never ran or did not finish again once for the same head. It arms no timer for a failed check: the next cycle that runs for another reason reads the head again, no sooner than 15 minutes, 1 hour, then 6 hours after the last look, and at once when new knowledge commits or a new base arrive. Fix a failing check in the repository, or, for an outside status that can never pass for Lervo Knowledge commits, such as a deployment preview, list its exact commit status name in publication.checks.ignore of this host's convergence owner configuration.",
  knowledge_publication_merge_failed:
    "Merging the knowledge publication pull request failed; the detail gives GitHub's reason. A failure GitHub may clear on its own is tried again after 2 minutes, doubling to an hour; after that the next cycle that runs for another reason tries again. Otherwise inspect the pull request and merge or close it.",
  knowledge_publication_policy_refused:
    "The repository's own policy requires something Lervo cannot do, so nothing was pushed; the detail names the branch and the rule. Allow a merge method on the base branch (merge, squash, or rebase), let the host read the branch protection, remove an update restriction on the base, or exempt the publication branch from rules that forbid force pushes or require signed commits, then run lervo knowledge convergence owner publish. Set publication.merge to never to merge the pull requests yourself.",
};

/** Remediations for the forge failure class a `gh <step> exit <code> <class>` detail names. */
const FORGE_FAILURE_INSTRUCTIONS: Record<string, string> = {
  auth: "The gh CLI on this host is not authenticated for this repository or lacks write access. Run gh auth status, log in with an account that can push and merge, then run lervo knowledge convergence owner publish.",
  rate_limited:
    "GitHub rate-limited the gh CLI on this host. Lervo tries again after 2 minutes, doubling to an hour, then on the next cycle that runs for another reason; nothing else is needed unless other tools on this host share the same token.",
  network:
    "The gh CLI on this host could not reach GitHub in time. Check the host's network and GitHub status; the next resident cycle retries.",
  not_installed:
    "The gh CLI is not installed or not on the resident's PATH on this host. Install it, log in, then run lervo knowledge convergence owner publish.",
  not_mergeable:
    "GitHub refused to merge the knowledge publication pull request because it is not mergeable at the published head. Inspect the pull request for conflicts or a branch policy, then merge or close it.",
  not_found:
    "GitHub could not find the knowledge publication pull request or repository. Check the host's gh repository context, then run lervo knowledge convergence owner publish.",
  method_not_allowed:
    "GitHub refused the merge method Lervo derived from the repository's policy, so the policy changed after it was read. The next publication reads it again; if this repeats, allow a merge method on the base branch.",
};

/** Remediations for each reason superseded knowledge commits stayed on the branch. */
/** Why superseded knowledge commits stayed on the branch; the replica cycle retries each. */
const SUPERSESSION_HELD_INSTRUCTIONS: Record<string, string> = {
  not_on_branch:
    "superseded Lervo Knowledge commits remain while HEAD is detached or a Git operation is in progress; the next replica cycle on the branch drops them.",
  under_other_work:
    "superseded Lervo Knowledge commits sit below other commits on this branch, so Lervo does not rewrite them and replication waits; a backup ref under refs/lervo/knowledge-superseded keeps them, and the replica cycle drops them once they are the branch tip.",
  worktree_conflict:
    "superseded Lervo Knowledge commits remain while uncommitted edits touch the same paths; the next replica cycle after those edits are committed drops them.",
};

/** Hub failures only a credential the owner holds can repair (ADR-0561 notice-only exception). */
const CREDENTIAL_FAILURES = new Set(["hub_unauthorized", "token_file_unreadable", "hub_forbidden"]);

function forgeFailureInstruction(detail: string | null): string | undefined {
  // ADR-0603: GitHub's own reason may follow the class after a colon.
  const failureClass =
    detail === null ? undefined : /^gh \S+ exit \S+ ([a-z_]+)(?::|$)/u.exec(detail)?.[1];
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
    // ADR-0561: the resident retries ownership coordination every cycle, and a contended
    // standalone host yields until the other host's lease window passes. Only a credential Lervo
    // cannot create is the owner's, and it is a notice.
    const credentials =
      verdict.role === "unverifiable" && CREDENTIAL_FAILURES.has(verdict.failureCode ?? "");
    const remediation = convergenceOwnerRemediation(verdict, input.hubScope ?? null)!;
    const item: KnowledgeConvergenceOwnerAttentionItemV1 = {
      schemaVersion: 1,
      kind: "knowledge_convergence_owner",
      itemId: `knowledge_convergence_owner_${verdict.role}`,
      state: credentials ? "credentials_missing" : "lervo_debt",
      role: verdict.role,
      reason: verdict.reason,
      failureCode: verdict.failureCode ?? null,
      httpStatus: verdict.httpStatus ?? null,
      holderLabel: verdict.holder?.label ?? null,
      observedAt: verdict.observedAt,
      actionOwner: credentials ? "user" : "host resident",
      requiresUserAction: credentials,
      blocking: false,
      instruction: credentials
        ? `Notice: ${remediation} Lervo continues every stage that does not need this credential.`
        : `Lervo debt: ${verdict.failureCode ?? verdict.reason}. The resident stays read-only for knowledge commits and retries ownership coordination on every cycle; nothing waits for the owner. Inspect with lervo knowledge convergence owner status.`,
      recordedInstruction: remediation,
    };
    items.push(item);
  }
  const failure =
    input.publication?.status === "failed" || input.publication?.status === "superseded"
      ? input.publication.failure
      : null;
  if (failure !== null && failure !== undefined) {
    // ADR-0561: Lervo retries every publication failure itself; only missing gh credentials,
    // which Lervo cannot create, are the owner's, and they are reported as a notice.
    // ADR-0603: GitHub's own reason may follow the class after a colon.
    const credentials = /^gh \S+ exit \S+ auth(?::|$)/u.test(failure.detail ?? "");
    const item: KnowledgePublicationAttentionItemV1 = {
      schemaVersion: 1,
      kind: "knowledge_publication",
      itemId: `knowledge_publication_${failure.code}`,
      state: credentials ? "credentials_missing" : "lervo_debt",
      failureCode: failure.code,
      detail: failure.detail,
      pullRequestUrl: input.publication?.pullRequestUrl ?? null,
      occurrences: failure.occurrences,
      firstObservedAt: failure.firstObservedAt,
      actionOwner: credentials ? "user" : "agent",
      requiresUserAction: credentials,
      blocking: false,
      instruction:
        forgeFailureInstruction(failure.detail) ??
        PUBLICATION_INSTRUCTIONS[failure.code] ??
        "Inspect lervo knowledge convergence owner status and retry the publication.",
    };
    items.push(item);
  }
  items.push(...publicationProgressItems(input.publication, input.publicationAcknowledged ?? null));
  const held = input.supersession?.held ?? null;
  if (held !== null) {
    const item: KnowledgePublicationAttentionItemV1 = {
      schemaVersion: 1,
      kind: "knowledge_publication",
      itemId: "knowledge_publication_knowledge_supersession_held",
      // ADR-0561: the replica cycle drops the commits once the branch allows it; Lervo debt.
      state: "lervo_debt",
      failureCode: "knowledge_supersession_held",
      detail: `${held.commitCount} superseded commit(s) held: ${held.reason}`,
      pullRequestUrl: null,
      occurrences: 1,
      firstObservedAt: held.observedAt,
      actionOwner: "host resident",
      requiresUserAction: false,
      blocking: false,
      instruction: `Lervo debt: ${SUPERSESSION_HELD_INSTRUCTIONS[held.reason]!}`,
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

/** ADR-0603: what each GitHub-side wait needs, once its schedule is spent. */
const WAIT_INSTRUCTIONS: Record<string, string> = {
  none: "No check reported on the knowledge publication pull request's head. Lervo merges only after at least one check succeeds; enable the repository's pull request workflows for the publication branch, or set publication.merge to never and merge the pull requests yourself.",
  skipped_only:
    "Every check on the knowledge publication pull request's head was skipped, so none succeeded. Make at least one workflow run for the publication branch, or set publication.merge to never and merge the pull requests yourself.",
  running:
    "A check on the knowledge publication pull request has not finished for over an hour, for example a job stuck in the queue. Inspect it on GitHub; Lervo reads it again on the next cycle that runs for another reason.",
  head_moved:
    "GitHub still reports another head for the knowledge publication pull request. Check that nothing else pushes to the publication branch.",
  draft:
    "The knowledge publication pull request is a draft, which only a person marks ready. Mark it ready for review, or close it to decline these outputs.",
  queued:
    "The knowledge publication pull request is in the base branch's merge queue. Lervo reads it again on the next cycle that runs for another reason; inspect the queue if it does not merge.",
  behind:
    "The base branch requires the knowledge publication pull request to be up to date, and the base keeps moving. Lervo rebuilds it on the next cycle that runs for another reason.",
  conflict:
    "GitHub reports the knowledge publication pull request in conflict with the base. Lervo rebuilds it on the next cycle that runs for another reason; inspect it if this repeats.",
  blocked:
    "GitHub blocks the knowledge publication pull request for a requirement it does not name. Inspect the pull request's merge box for the missing requirement.",
};

/**
 * ADR-0603: what a publication waits on that is no failure: a review only a person can give, a
 * GitHub-side wait whose schedule is spent, pull requests a person closed without merge, and paths
 * the base changed after a merge, such as by a revert. The last two are the owner's decisions,
 * which Lervo keeps; `lervo knowledge convergence owner acknowledge` ends their attention.
 */
function publicationProgressItems(
  publication: KnowledgeConvergenceAttentionInput["publication"],
  acknowledged: KnowledgeConvergenceAttentionInput["publicationAcknowledged"] | null,
): KnowledgePublicationAttentionItemV1[] {
  if (publication === null) return [];
  const item = (
    failureCode: string,
    detail: string,
    firstObservedAt: string,
    instruction: string,
  ): KnowledgePublicationAttentionItemV1 => ({
    schemaVersion: 1,
    kind: "knowledge_publication",
    itemId: `knowledge_publication_${failureCode}`,
    state: "lervo_debt",
    failureCode,
    detail,
    pullRequestUrl: publication.pullRequestUrl,
    occurrences: 1,
    firstObservedAt,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction,
  });
  const items: KnowledgePublicationAttentionItemV1[] = [];
  const wait = publication.wait;
  const open = publication.status === "open" || publication.status === "awaiting_checks";
  if (open && wait?.kind === "review")
    items.push(
      item(
        "knowledge_publication_awaiting_review",
        `${wait.attempts} look(s) at head ${wait.head.slice(0, 12)}`,
        wait.since,
        "The repository requires an approving review before the knowledge publication pull request can merge. Lervo reads it again after 15 minutes and 1 hour, then on the next cycle that runs for another reason, and merges once it is approved. Set publication.merge to never to merge the pull requests yourself.",
      ),
    );
  else if (open && wait !== undefined && knowledgePublicationWaitExhausted(wait))
    items.push(
      item(
        "knowledge_publication_waiting",
        `${wait.kind} ${wait.reason} at head ${wait.head.slice(0, 12)} after ${wait.attempts} look(s)`,
        wait.since,
        `${WAIT_INSTRUCTIONS[wait.reason] ?? WAIT_INSTRUCTIONS.blocked!} Lervo looked again after 2 minutes, doubling to an hour, and now reads it only when a cycle runs for another reason.`,
      ),
    );
  const declined = (publication.declined ?? []).filter(
    (closed) => !(acknowledged?.declined ?? []).includes(closed.pullRequestNumber),
  );
  if (declined.length > 0)
    items.push(
      item(
        "knowledge_publication_declined",
        declined
          .map((closed) => `#${closed.pullRequestNumber} (${closed.commitCount} commit(s))`)
          .join(", "),
        publication.updatedAt,
        "A person closed a knowledge publication pull request without merging it. Lervo treats that as a decision: it does not reopen the pull request or publish those commits again, and convergence changes those documents again only when their sources change. Reopen the pull request to publish it after all, or run lervo knowledge convergence owner acknowledge to keep the decision without this notice.",
      ),
    );
  if (publication.historyUncached === true)
    items.push(
      item(
        "knowledge_publication_history_uncached",
        "the pull request history is larger than its cache budget",
        publication.updatedAt,
        "The publication branch's pull request history no longer fits the local cache, so every cycle that asks GitHub reads it whole, which costs more GitHub requests. Nothing is published wrongly; delete merged publication branches you no longer need, or report it to Lervo.",
      ),
    );
  const changed = publication.baseChanged;
  if (changed !== undefined && changed.key !== acknowledged?.baseChange)
    items.push(
      item(
        "knowledge_publication_base_changed",
        `${changed.paths} path(s) of pull request #${changed.pullRequestNumber} differ on the base from its merge commit ${changed.mergeCommit.slice(0, 12)}`,
        publication.updatedAt,
        "The base branch changed paths the last merged knowledge publication landed, for example by a revert or a person's edit. Lervo keeps the base's bytes and does not publish those commits again; convergence changes those documents again only when their sources change. Run lervo knowledge convergence owner acknowledge to keep the change without this notice; it returns if those paths change again.",
      ),
    );
  return items;
}
