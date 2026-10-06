import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import {
  KNOWLEDGE_PUBLICATION_TITLE,
  renderKnowledgePublicationBody,
} from "./knowledge-publication-body.js";
import {
  loadRepositoryKnowledgeOutputFormatter,
  type KnowledgeOutputFormatter,
} from "./knowledge-output-formatter.js";
import {
  KnowledgePublicationForgeError,
  type KnowledgePublicationForge,
} from "./knowledge-publication-forge.js";
import {
  fetchKnowledgePublicationRefs,
  inventoryKnowledgePublication,
  KnowledgePublicationGitError,
  type KnowledgePublicationInventory,
  pushKnowledgePublicationTip,
  remoteTrackingHead,
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
  MAXIMUM_SUPERSEDED_COMMITS,
  nextKnowledgePublicationFailure,
  readKnowledgePublicationState,
  writeKnowledgePublicationState,
  type KnowledgePublicationFailureCode,
  type KnowledgePublicationState,
} from "./knowledge-publication-state.js";
import { supersedeStaleKnowledgeCommits } from "./knowledge-publication-supersession.js";
import {
  reconcileKnowledgeSupersession,
  recordKnowledgeSupersession,
} from "./knowledge-supersession.js";
import {
  buildKnowledgePublicationTip,
  equivalentPublishedHead,
} from "./knowledge-publication-tip.js";

/** While checks run, the resident looks again after this delay instead of its idle backoff. */
export const KNOWLEDGE_PUBLICATION_CHECK_INTERVAL_MS = 2 * 60_000;
/**
 * After superseded commits left the local base branch, the resident runs its next cycle this soon:
 * the moved head changes the source fingerprint, so convergence regenerates the outputs against
 * the current base instead of waiting out its idle backoff.
 */
export const KNOWLEDGE_PUBLICATION_REQUEUE_DELAY_MS = 5_000;

const SUPERSEDED_COMMENT =
  "Closed by the Lervo knowledge publisher: these knowledge commits were computed against an older base and conflict with the current base, so they will not be published. Convergence regenerates the affected outputs against the current base, and the next publication opens a new pull request.";

export type KnowledgePublicationOutcome =
  | { status: "disabled" | "not_owner" | "unchanged" }
  | { status: "published"; state: KnowledgePublicationState; retryAfterMs: number | null };

class PublicationFailure extends Error {
  constructor(
    readonly code: KnowledgePublicationFailureCode,
    readonly detail: string | null,
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}

/** Path-free detail of a Git or forge failure: the step, the exit code, and the forge's class. */
function failureDetail(error: unknown): string | null {
  if (error instanceof KnowledgePublicationGitError)
    return `git ${error.stage} exit ${error.exitCode ?? "unknown"}`;
  if (error instanceof KnowledgePublicationForgeError) return error.detail;
  return null;
}

async function step<T>(code: KnowledgePublicationFailureCode, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PublicationFailure) throw error;
    throw new PublicationFailure(code, failureDetail(error), { cause: error });
  }
}

const PULL_REQUEST_OPEN = new Set(["awaiting_checks", "open"]);

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
}): Promise<KnowledgePublicationOutcome> {
  const root = input.repositoryRoot;
  const now = input.now ?? (() => new Date());
  const host = await readConvergenceOwnerHost(root).catch(() => null);
  const settings = host?.config.publication;
  if (host === null || settings === undefined) return { status: "disabled" };
  if (!(await knowledgeOutputCommitGrant(root, now().getTime())).allowed)
    return { status: "not_owner" };
  const previous = await readKnowledgePublicationState(root);
  // Superseded commits a replica brought back from another host leave this branch first.
  const supersession = await reconcileKnowledgeSupersession({ repositoryRoot: root, now }).catch(
    () => null,
  );
  const superseded = new Set([
    ...(previous?.supersededCommits ?? []),
    ...(supersession?.entries.map((entry) => entry.commit) ?? []),
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
  const local = await inventoryKnowledgePublication(root, settings, superseded).catch(() => null);
  if (
    local !== null &&
    local.knowledge.length === 0 &&
    previous !== null &&
    !PULL_REQUEST_OPEN.has(previous.status) &&
    previous.status !== "failed"
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
  };
  // The latest durable progress, so a failure after the pull request opened keeps its coordinates.
  const progress = { current: base, requeue: false };
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
      base,
      progress,
    });
  } catch (error) {
    if (!(error instanceof PublicationFailure)) throw error;
    state = {
      ...progress.current,
      status: "failed",
      failure: nextKnowledgePublicationFailure(
        previous?.failure ?? null,
        error.code,
        error.detail,
        base.updatedAt,
      ),
    };
  }
  await writeKnowledgePublicationState(root, state);
  return {
    status: "published",
    state,
    retryAfterMs:
      state.status === "awaiting_checks"
        ? KNOWLEDGE_PUBLICATION_CHECK_INTERVAL_MS
        : progress.requeue
          ? KNOWLEDGE_PUBLICATION_REQUEUE_DELAY_MS
          : null,
  };
}

const withoutPullRequest = (state: KnowledgePublicationState): KnowledgePublicationState => ({
  ...state,
  pullRequestNumber: null,
  pullRequestUrl: null,
  publishedHead: null,
});

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
  base: KnowledgePublicationState;
  progress: { current: KnowledgePublicationState; requeue: boolean };
}): Promise<KnowledgePublicationState> {
  const { root, settings, forge, base } = input;
  await step("knowledge_publication_fetch_failed", () =>
    fetchKnowledgePublicationRefs(root, settings),
  );
  const inventory = await step("knowledge_publication_fetch_failed", async () => {
    const value = await inventoryKnowledgePublication(root, settings, input.superseded);
    if (value === null)
      throw new PublicationFailure("knowledge_publication_fetch_failed", "base branch absent");
    return value;
  });
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
    return afterMerge(root, settings, base);
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
  const built = await step("knowledge_publication_conflict", async () =>
    buildKnowledgePublicationTip(root, inventory, await input.formatter()),
  );
  if (built.status === "conflict")
    return supersede({ ...input, inventory, conflictPathCount: built.conflictPathCount });
  // Unchanged content keeps the published head, so its checks are not restarted.
  const tip = await step("knowledge_publication_push_failed", async () => {
    const remoteHead = await remoteTrackingHead(root, settings, settings.branch);
    const published = await equivalentPublishedHead(root, inventory.base, built.tip, remoteHead);
    if (published !== null) return published;
    await pushKnowledgePublicationTip(root, settings, built.tip, remoteHead);
    return built.tip;
  });
  const body = renderKnowledgePublicationBody({
    commits: inventory.knowledge,
    settings,
    host: input.host,
    rebuilt: built.replayed,
    formattedPathCount: built.formattedPathCount,
  });
  const pullRequest = await step("knowledge_publication_pull_request_failed", async () => {
    const existing = await forge.findPullRequest({
      head: settings.branch,
      base: settings.baseBranch,
    });
    if (existing === null)
      return forge.createPullRequest({
        head: settings.branch,
        base: settings.baseBranch,
        title: KNOWLEDGE_PUBLICATION_TITLE,
        body,
      });
    if (existing.title !== KNOWLEDGE_PUBLICATION_TITLE || existing.body.trim() !== body.trim())
      // A stale description never blocks merging reviewed outputs; the next cycle retries it.
      await forge
        .updatePullRequest({ number: existing.number, title: KNOWLEDGE_PUBLICATION_TITLE, body })
        .catch((error: unknown) => {
          if (!(error instanceof KnowledgePublicationForgeError)) throw error;
        });
    return existing;
  });
  const opened: KnowledgePublicationState = {
    ...base,
    status: "open",
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
    publishedHead: tip,
    commitCount: inventory.knowledge.length,
  };
  input.progress.current = opened;
  if (settings.merge === "never") return opened;
  const checks = await step("knowledge_publication_pull_request_failed", () =>
    forge.checks({ number: pullRequest.number, headSha: tip }),
  );
  if (checks.state === "pending") return { ...opened, status: "awaiting_checks" };
  if (checks.state === "failed")
    throw new PublicationFailure(
      "knowledge_publication_checks_failed",
      `${checks.failed} of ${checks.total} checks failed`,
    );
  const merged = await step("knowledge_publication_merge_failed", () =>
    forge.merge({ number: pullRequest.number, headSha: tip }).then(
      () => true,
      (error: unknown) => {
        // GitHub can still count a check as running after the rollup reported it finished.
        if (error instanceof KnowledgePublicationForgeError) {
          if (error.failureClass === "checks_pending") return false;
          if (error.failureClass === "checks_failed")
            throw new PublicationFailure("knowledge_publication_checks_failed", error.detail);
        }
        throw error;
      },
    ),
  );
  if (!merged) return { ...opened, status: "awaiting_checks" };
  await step("knowledge_publication_fetch_failed", () =>
    fetchKnowledgePublicationRefs(root, settings),
  );
  return afterMerge(root, settings, opened);
}

/**
 * A replay conflict means the commits were computed against stale source bytes. They are never
 * published: they enter the supersession ledger the replica carries to other checkouts, an open
 * publication pull request, which carries only them, is closed, then the local branch is backed
 * up and moved to the remote base when no work can be lost, which requeues convergence there. One `knowledge_publication_superseded` failure records the outcome.
 */
async function supersede(input: {
  root: string;
  settings: KnowledgePublicationSettings;
  forge: KnowledgePublicationForge;
  previous: KnowledgePublicationState | null;
  base: KnowledgePublicationState;
  progress: { current: KnowledgePublicationState; requeue: boolean };
  inventory: KnowledgePublicationInventory;
  conflictPathCount: number;
}): Promise<KnowledgePublicationState> {
  const { root, settings, forge, base, inventory } = input;
  // Recorded first, so a replica drops the same commits on every host even if a later step fails.
  await step("knowledge_publication_conflict", () =>
    recordKnowledgeSupersession({
      repositoryRoot: root,
      commits: inventory.knowledge.map((commit) => commit.sha),
      base: inventory.base,
      supersededAt: base.updatedAt,
    }),
  );
  const open = await step("knowledge_publication_pull_request_failed", () =>
    forge.findPullRequest({ head: settings.branch, base: settings.baseBranch }),
  );
  if (open !== null)
    await step("knowledge_publication_pull_request_failed", () =>
      forge.closePullRequest({ number: open.number, comment: SUPERSEDED_COMMENT }),
    );
  input.progress.current = withoutPullRequest(base);
  const { backupRef, localReset } = await step("knowledge_publication_conflict", () =>
    supersedeStaleKnowledgeCommits(root, settings, inventory),
  );
  input.progress.requeue = localReset;
  const detail = `${input.conflictPathCount} conflicting path(s) in ${inventory.knowledge.length} commit(s); ${
    localReset
      ? "local base reset to the remote base and convergence requeued"
      : "local base kept because it holds other work or moved"
  }; backup ${backupRef}`;
  return {
    ...withoutPullRequest(base),
    status: "superseded",
    commitCount: inventory.knowledge.length,
    failure: nextKnowledgePublicationFailure(
      input.previous?.failure ?? null,
      "knowledge_publication_superseded",
      detail,
      base.updatedAt,
    ),
    supersededCommits: localReset
      ? []
      : [
          ...(base.supersededCommits ?? []),
          ...inventory.knowledge.map((commit) => commit.sha),
        ].slice(-MAXIMUM_SUPERSEDED_COMMITS),
  };
}

async function afterMerge(
  root: string,
  settings: KnowledgePublicationSettings,
  state: KnowledgePublicationState,
): Promise<KnowledgePublicationState> {
  // A failed local catch-up never undoes the merge; the next cycle retries it.
  const synced = await syncLocalBaseAfterPublication(root, settings).catch(
    () => "diverged" as const,
  );
  return { ...state, status: synced === "diverged" ? "local_diverged" : "merged" };
}
