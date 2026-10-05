import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import {
  KNOWLEDGE_PUBLICATION_TITLE,
  renderKnowledgePublicationBody,
} from "./knowledge-publication-body.js";
import type { KnowledgePublicationForge } from "./knowledge-publication-forge.js";
import {
  buildKnowledgePublicationTip,
  fetchKnowledgePublicationRefs,
  inventoryKnowledgePublication,
  KnowledgePublicationGitError,
  knowledgePublicationScopeViolations,
  pushKnowledgePublicationTip,
  remoteTrackingHead,
  syncLocalBaseAfterPublication,
} from "./knowledge-publication-git.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";
import {
  nextKnowledgePublicationFailure,
  readKnowledgePublicationState,
  writeKnowledgePublicationState,
  type KnowledgePublicationFailureCode,
  type KnowledgePublicationState,
} from "./knowledge-publication-state.js";

/** While checks run, the resident looks again after this delay instead of its idle backoff. */
export const KNOWLEDGE_PUBLICATION_CHECK_INTERVAL_MS = 2 * 60_000;

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

function gitDetail(error: unknown): string | null {
  return error instanceof KnowledgePublicationGitError
    ? `git ${error.stage} exit ${error.exitCode ?? "unknown"}`
    : null;
}

async function step<T>(code: KnowledgePublicationFailureCode, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PublicationFailure) throw error;
    throw new PublicationFailure(code, gitDetail(error), { cause: error });
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
  now?: () => Date;
}): Promise<KnowledgePublicationOutcome> {
  const root = input.repositoryRoot;
  const now = input.now ?? (() => new Date());
  const host = await readConvergenceOwnerHost(root).catch(() => null);
  const settings = host?.config.publication;
  if (host === null || settings === undefined) return { status: "disabled" };
  if (!(await knowledgeOutputCommitGrant(root, now().getTime())).allowed)
    return { status: "not_owner" };
  const previous = await readKnowledgePublicationState(root);
  // Without new local commits or an open pull request there is nothing to ask the remote.
  const local = await inventoryKnowledgePublication(root, settings).catch(() => null);
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
  };
  // The latest durable progress, so a failure after the pull request opened keeps its coordinates.
  const progress = { current: base };
  let state: KnowledgePublicationState;
  try {
    state = await publish({
      root,
      settings,
      forge: input.forge,
      host: { hostHash: host.hostHash, hostLabel: host.config.hostLabel },
      previous,
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
      state.status === "awaiting_checks" ? KNOWLEDGE_PUBLICATION_CHECK_INTERVAL_MS : null,
  };
}

async function publish(input: {
  root: string;
  settings: KnowledgePublicationSettings;
  forge: KnowledgePublicationForge;
  host: { hostHash: string; hostLabel: string };
  previous: KnowledgePublicationState | null;
  base: KnowledgePublicationState;
  progress: { current: KnowledgePublicationState };
}): Promise<KnowledgePublicationState> {
  const { root, settings, forge, base } = input;
  await step("knowledge_publication_fetch_failed", () =>
    fetchKnowledgePublicationRefs(root, settings),
  );
  const inventory = await step("knowledge_publication_fetch_failed", async () => {
    const value = await inventoryKnowledgePublication(root, settings);
    if (value === null)
      throw new PublicationFailure("knowledge_publication_fetch_failed", "base branch absent");
    return value;
  });
  if (inventory.knowledge.length === 0) {
    const number = input.previous?.pullRequestNumber ?? null;
    if (number === null || !PULL_REQUEST_OPEN.has(input.previous?.status ?? "idle"))
      return { ...base, status: "idle" };
    const pullRequest = await step("knowledge_publication_pull_request_failed", () =>
      forge.viewPullRequest(number),
    );
    if (pullRequest.state !== "merged")
      return { ...base, status: pullRequest.state === "open" ? input.previous!.status : "idle" };
    return afterMerge(root, settings, base);
  }
  const violations = knowledgePublicationScopeViolations(
    inventory.knowledge,
    settings.allowedRoots,
  );
  if (violations.length > 0)
    throw new PublicationFailure(
      "knowledge_publication_scope_violation",
      `${violations.length} path(s) outside the allowed roots`,
    );
  const tip = await step("knowledge_publication_conflict", async () => {
    const value = await buildKnowledgePublicationTip(root, inventory);
    if (value === null)
      throw new PublicationFailure("knowledge_publication_conflict", "replay conflict");
    return value;
  });
  await step("knowledge_publication_push_failed", async () =>
    pushKnowledgePublicationTip(
      root,
      settings,
      tip,
      await remoteTrackingHead(root, settings, settings.branch),
    ),
  );
  const body = renderKnowledgePublicationBody({
    commits: inventory.knowledge,
    settings,
    host: input.host,
    rebuilt: tip !== inventory.head,
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
      await forge.updatePullRequest({
        number: existing.number,
        title: KNOWLEDGE_PUBLICATION_TITLE,
        body,
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
  await step("knowledge_publication_merge_failed", () =>
    forge.merge({ number: pullRequest.number, headSha: tip }),
  );
  await step("knowledge_publication_fetch_failed", () =>
    fetchKnowledgePublicationRefs(root, settings),
  );
  return afterMerge(root, settings, opened);
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
