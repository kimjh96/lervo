import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import {
  loadRepositoryKnowledgeOutputFormatter,
  type KnowledgeOutputFormatter,
} from "./knowledge-output-formatter.js";
import {
  currentChecksRetry,
  knowledgePublicationChecksWaiting,
  knowledgePublicationInventoryKey,
  recoverFailedKnowledgePublicationChecks,
} from "./knowledge-publication-checks.js";
import type { KnowledgePublicationForge } from "./knowledge-publication-forge.js";
import {
  knowledgePublicationRetryDelay,
  PublicationFailure,
  step,
} from "./knowledge-publication-failure.js";
import { openKnowledgePublicationHead } from "./knowledge-publication-head.js";
import {
  readKnowledgePublicationHistoryCache,
  type KnowledgePublicationHistoryCache,
} from "./knowledge-publication-history.js";
import {
  carriedState,
  observe,
  readKnowledgePublicationStanding,
  withoutWait,
} from "./knowledge-publication-standing.js";
import {
  supersedeKnowledgePublication,
  withoutPullRequest,
} from "./knowledge-publication-conflict.js";
import { mergeKnowledgePublication } from "./knowledge-publication-merge.js";
import { observeBaseChange } from "./knowledge-publication-tracking.js";
import {
  knowledgePublicationCarriedDigest,
  knowledgePublicationWaitDelay,
  nextKnowledgePublicationWait,
  sameKnowledgePublicationWait,
  type KnowledgePublicationWaitKind,
} from "./knowledge-publication-wait.js";
import { planKnowledgePublication } from "./knowledge-publication-policy.js";
import {
  fetchKnowledgePublicationRefs,
  inventoryKnowledgePublication,
  syncLocalBaseAfterPublication,
} from "./knowledge-publication-git.js";
import {
  knowledgePublicationViolationDetail,
  repairKnowledgePublication,
  type KnowledgePublicationRepairEvents,
  type KnowledgePublicationRepairOutcome,
} from "./knowledge-publication-repair.js";
import {
  knowledgePublicationViolations,
  loadKnowledgePublicationScope,
  type KnowledgePublicationScope,
} from "./knowledge-publication-scope.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";
import {
  nextKnowledgePublicationFailure,
  readKnowledgePublicationState,
  writeKnowledgePublicationState,
  type KnowledgePublicationState,
} from "./knowledge-publication-state.js";
import { reconcileKnowledgeSupersession } from "./knowledge-supersession.js";

/**
 * After superseded commits left the local base branch, the resident runs its next cycle this soon:
 * the moved head changes the source fingerprint, so convergence regenerates the outputs against
 * the current base instead of waiting out its idle backoff.
 */
export const KNOWLEDGE_PUBLICATION_REQUEUE_DELAY_MS = 5_000;

export type KnowledgePublicationOutcome =
  | { status: "disabled" | "not_owner" | "unchanged" }
  | { status: "published"; state: KnowledgePublicationState; retryAfterMs: number | null };

const PULL_REQUEST_OPEN = new Set(["awaiting_checks", "open"]);

type Progress = {
  current: KnowledgePublicationState;
  requeue: boolean;
  /** Re-keys the history cache once the publication is over; set once GitHub was read. */
  refresh?: () => Promise<void>;
};

/**
 * Publishes the convergence owner's settled knowledge commits to one rolling branch and pull
 * request, merges it when allowed and every check passed, and then brings the local base branch
 * up to the merged result when no work can be lost. Only the current owner publishes; the base
 * branch is never pushed. One failure code at a time is kept for operating attention.
 */
export async function publishKnowledgeOutputs(input: {
  repositoryRoot: string;
  forge: KnowledgePublicationForge;
  /** The repository formatter; omitted loads the repository's own, null skips formatting. */
  formatter?: KnowledgeOutputFormatter | null;
  now?: () => Date;
  /** Receives `knowledge.publication.repaired`; without it the repair commit is the only record. */
  events?: KnowledgePublicationRepairEvents;
  /** A host-side reason to hold the merge; see `mergeKnowledgePublication`. */
  mergeHold?: () => Promise<string | null>;
}): Promise<KnowledgePublicationOutcome> {
  const root = input.repositoryRoot;
  const now = input.now ?? (() => new Date());
  const host = await readConvergenceOwnerHost(root).catch(() => null);
  const settings = host?.config.publication;
  if (host === null || settings === undefined) return { status: "disabled" };
  if (!(await knowledgeOutputCommitGrant(root, now().getTime())).allowed)
    return { status: "not_owner" };
  const previous = await readKnowledgePublicationState(root);
  const cache = await readKnowledgePublicationHistoryCache(root);
  // ADR-0607: the local part answers only for this host; the history part, for the repository.
  const cachedLocal = cache?.local?.hostHash === host.hostHash ? cache.local : null;
  // Superseded commits a replica brought back from another host leave this branch first.
  const supersession = await reconcileKnowledgeSupersession({ repositoryRoot: root, now }).catch(
    () => null,
  );
  const superseded = new Set([
    ...(previous?.supersededCommits ?? []),
    ...(supersession?.entries.map((entry) => entry.commit) ?? []),
  ]);
  // ADR-0603: GitHub says what is published; this cache and the legacy local ledger only spare a
  // cycle that has nothing to ask it, and the next cycle that asks rebuilds them.
  const published = new Set<string>([
    ...(cachedLocal?.published ?? []),
    ...(previous?.publishedCommits ?? []),
  ]);
  const scope = await loadKnowledgePublicationScope(root, settings, now());
  // ADR-0473: tool-owned and out-of-scope paths are restored before anything is published. A
  // failed repair publishes nothing either: the scope check below still refuses those paths.
  const repair = await repairKnowledgePublication({
    repositoryRoot: root,
    settings,
    scope,
    superseded,
    now,
    ...(input.events === undefined ? {} : { events: input.events }),
  }).catch(() => null);
  // Without new local commits or an open pull request there is nothing to ask the remote.
  const local = await inventoryKnowledgePublication(
    root,
    settings,
    new Set([...superseded, ...(cachedLocal?.declined ?? []).flatMap((item) => item.commits)]),
    published,
  ).catch(() => null);
  // ADR-0603: the cache answers only for the host, base and head it was derived for; anything
  // else, and a merge whose commit the forge had not reported yet, asks GitHub again.
  const covered =
    cachedLocal !== null &&
    local !== null &&
    cachedLocal.base === local.base &&
    cachedLocal.head === local.head &&
    cachedLocal.lastMerged?.mergeCommit !== null;
  if (
    covered &&
    local.knowledge.length === 0 &&
    previous !== null &&
    !PULL_REQUEST_OPEN.has(previous.status) &&
    previous.status !== "failed"
  ) {
    // ADR-0603: a revert of the last merged publication is noticed without asking the remote.
    const observed = { ...previous };
    observe(observed, null, await observeBaseChange(root, local.base, cachedLocal.lastMerged));
    if (observed.baseChanged?.key !== previous.baseChanged?.key)
      await writeKnowledgePublicationState(root, observed);
    return { status: "unchanged" };
  }
  // ADR-0596: failed checks on an unchanged head and inventory wait out their backoff offline.
  if (
    knowledgePublicationChecksWaiting(
      previous,
      local === null ? null : knowledgePublicationInventoryKey(local),
      now(),
    )
  )
    return { status: "unchanged" };
  const base: KnowledgePublicationState = {
    schemaVersion: 1,
    status: "idle",
    pullRequestNumber: previous?.pullRequestNumber ?? null,
    pullRequestUrl: previous?.pullRequestUrl ?? null,
    publishedHead: previous?.publishedHead ?? null,
    commitCount: previous?.commitCount ?? 0,
    updatedAt: now().toISOString(),
    failure: null,
    supersededCommits: previous?.supersededCommits ?? [],
    ...carriedState(previous),
  };
  // The latest durable progress, so a failure after the pull request opened keeps its coordinates.
  const progress: Progress = { current: base, requeue: false };
  let state: KnowledgePublicationState;
  try {
    state = await publish({
      root,
      settings,
      forge: input.forge,
      formatter: () =>
        input.formatter === undefined
          ? loadRepositoryKnowledgeOutputFormatter(root)
          : Promise.resolve(input.formatter),
      host: { hostHash: host.hostHash, hostLabel: host.config.hostLabel },
      scope,
      repair,
      previous,
      superseded,
      published,
      cache,
      base,
      progress,
      now: now(),
      ...(input.mergeHold === undefined ? {} : { mergeHold: input.mergeHold }),
    });
  } catch (error) {
    if (!(error instanceof PublicationFailure)) throw error;
    const failure = nextKnowledgePublicationFailure(
      previous?.failure ?? null,
      error.code,
      error.detail,
      base.updatedAt,
    );
    state = { ...progress.current, status: "failed", failure };
    // ADR-0603: a failure that can clear on its own is tried again at a backoff deadline; one that
    // needs a person or a policy change stays attention and waits for a change. The backoff
    // counts every transient failure in a row, so alternating codes cannot restart it.
    if (error.transient) {
      const streak = Math.min((previous?.transientFailures ?? 0) + 1, 1_000_000);
      state = { ...state, transientFailures: streak };
      await writeKnowledgePublicationState(root, state);
      await progress.refresh?.();
      return {
        status: "published",
        state,
        retryAfterMs: knowledgePublicationRetryDelay(streak),
      };
    }
  }
  await writeKnowledgePublicationState(root, state);
  await progress.refresh?.();
  return {
    status: "published",
    state,
    retryAfterMs: progress.requeue
      ? KNOWLEDGE_PUBLICATION_REQUEUE_DELAY_MS
      : // ADR-0602: GitHub-side waits look again on a growing schedule, then arm no timer.
        state.wait !== undefined && PULL_REQUEST_OPEN.has(state.status)
        ? knowledgePublicationWaitDelay(state.wait)
        : null,
  };
}

async function publish(input: {
  root: string;
  settings: KnowledgePublicationSettings;
  forge: KnowledgePublicationForge;
  formatter: () => Promise<KnowledgeOutputFormatter | null>;
  host: { hostHash: string; hostLabel: string };
  scope: KnowledgePublicationScope;
  repair: KnowledgePublicationRepairOutcome | null;
  previous: KnowledgePublicationState | null;
  superseded: ReadonlySet<string>;
  published: Set<string>;
  cache: KnowledgePublicationHistoryCache | null;
  base: KnowledgePublicationState;
  progress: Progress;
  now: Date;
  mergeHold?: () => Promise<string | null>;
}): Promise<KnowledgePublicationState> {
  const { root, settings, forge, base } = input;
  await step("knowledge_publication_fetch_failed", () =>
    fetchKnowledgePublicationRefs(root, settings),
  );
  const { inventory, recordMerge, refresh } = await readKnowledgePublicationStanding({
    root,
    settings,
    forge,
    hostHash: input.host.hostHash,
    superseded: input.superseded,
    published: input.published,
    state: base,
    cache: input.cache,
  });
  input.progress.refresh = refresh;
  if (inventory.knowledge.length === 0) {
    const number = input.previous?.pullRequestNumber ?? null;
    if (number === null || !PULL_REQUEST_OPEN.has(input.previous?.status ?? "idle"))
      return { ...base, status: "idle" };
    // A pull request closed or removed outside the publisher leaves nothing to wait for.
    const pullRequest = await forge
      .viewPullRequest(number)
      .catch(() =>
        step("knowledge_publication_pull_request_failed", () =>
          forge.findPullRequest({ head: settings.branch, base: settings.baseBranch }),
        ),
      );
    if (pullRequest === null || pullRequest.state === "closed")
      return { ...withoutPullRequest(base), status: "idle" };
    if (pullRequest.state === "open")
      return {
        ...base,
        status: input.previous!.status,
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.url,
      };
    return afterMerge(root, settings, withoutWait(base), input.published);
  }
  const violations = await knowledgePublicationViolations({
    repositoryRoot: root,
    commits: inventory.knowledge,
    scope: input.scope,
  });
  if (violations.length > 0)
    throw new PublicationFailure(
      "knowledge_publication_scope_violation",
      knowledgePublicationViolationDetail(violations, input.repair),
    );
  // ADR-0603: how to publish comes from the repository's own policy, read before anything is
  // pushed; a requirement Lervo cannot meet is refused here, never discovered at merge.
  const plan = planKnowledgePublication(
    await step("knowledge_publication_pull_request_failed", () =>
      forge.policy({ base: settings.baseBranch, branch: settings.branch }),
    ),
    settings,
  );
  if (plan.status === "refused")
    throw new PublicationFailure("knowledge_publication_policy_refused", plan.detail, {
      transient: false,
    });
  const head = await openKnowledgePublicationHead({
    root,
    settings,
    forge,
    inventory,
    formatter: input.formatter,
    host: input.host,
    method: plan.merge,
  });
  if (head.status === "conflict")
    return supersedeKnowledgePublication({
      ...input,
      inventory,
      conflictPathCount: head.conflictPathCount,
    });
  const { tip, pullRequest } = head;
  const retry = currentChecksRetry(input.previous, tip);
  const carried = knowledgePublicationCarriedDigest(
    inventory.knowledge.map((commit) => commit.sha),
  );
  const waitKey = { pullRequestNumber: pullRequest.number, carried };
  const opened: KnowledgePublicationState = {
    ...(sameKnowledgePublicationWait(base.wait, waitKey) ? base : withoutWait(base)),
    ...(retry === undefined ? {} : { checksRetry: retry }),
    status: "open",
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
    publishedHead: tip,
    commitCount: inventory.knowledge.length,
  };
  input.progress.current = opened;
  // A person merges; nothing is awaited, so nothing is read again on a timer.
  if (plan.merge === null) return withoutWait(opened);
  const waiting = (kind: KnowledgePublicationWaitKind, reason: string) => ({
    ...opened,
    status: kind === "review" ? ("open" as const) : ("awaiting_checks" as const),
    wait: nextKnowledgePublicationWait(opened.wait, {
      ...waitKey,
      head: tip,
      kind,
      reason,
      now: input.now,
    }),
  });
  const checks = await step("knowledge_publication_pull_request_failed", () =>
    forge.checks({
      number: pullRequest.number,
      headSha: tip,
      ...(settings.checks === undefined ? {} : { ignore: settings.checks.ignore }),
      ...(plan.requiredChecks.length === 0 ? {} : { required: plan.requiredChecks }),
    }),
  );
  if (checks.state === "pending") return waiting("checks", checks.reason);
  if (checks.state === "failed") {
    const recovery = await recoverFailedKnowledgePublicationChecks({
      forge,
      now: input.now,
      opened,
      inventory,
      checks,
    });
    if (recovery.status === "rerun") return { ...recovery.state, ...waiting("checks", "rerun") };
    input.progress.current = recovery.state;
    throw new PublicationFailure("knowledge_publication_checks_failed", recovery.detail);
  }
  const merged = await mergeKnowledgePublication({
    forge,
    number: pullRequest.number,
    headSha: tip,
    method: plan.merge,
    ...(input.mergeHold === undefined ? {} : { hold: input.mergeHold }),
  });
  if (merged.status === "waiting") return waiting(merged.kind, merged.reason);
  // ADR-0603: the record in the body says the same; a merge commit not reported yet is read again.
  for (const commit of inventory.knowledge) input.published.add(commit.sha);
  const done = withoutWait(opened);
  delete done.baseChanged;
  input.progress.current = done;
  await step("knowledge_publication_fetch_failed", () =>
    fetchKnowledgePublicationRefs(root, settings),
  );
  recordMerge({ pullRequestNumber: pullRequest.number, mergeCommit: merged.mergeCommit });
  return afterMerge(root, settings, done, input.published);
}

async function afterMerge(
  root: string,
  settings: KnowledgePublicationSettings,
  state: KnowledgePublicationState,
  published: ReadonlySet<string>,
): Promise<KnowledgePublicationState> {
  // A failed local catch-up never undoes the merge; the next cycle retries it.
  const synced = await syncLocalBaseAfterPublication(root, settings, published).catch(
    () => "diverged" as const,
  );
  return { ...state, status: synced === "diverged" ? "local_diverged" : "merged" };
}
