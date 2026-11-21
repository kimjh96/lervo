import { PublicationFailure, step } from "./knowledge-publication-failure.js";
import type { KnowledgePublicationForge } from "./knowledge-publication-forge.js";
import {
  git,
  inventoryKnowledgePublication,
  remoteTrackingHead,
  type KnowledgePublicationInventory,
} from "./knowledge-publication-git.js";
import {
  closedByLervo,
  deriveKnowledgePublicationHistory,
  parseKnowledgePublicationRecord,
  writeKnowledgePublicationHistoryCache,
  type KnowledgePublicationClosure,
  type KnowledgePublicationDeclined,
  type KnowledgePublicationHistory,
  type KnowledgePublicationHistoryCache,
} from "./knowledge-publication-history.js";
import {
  builtAfterMerges,
  localPatches,
  pullRequestPatchIds,
} from "./knowledge-publication-pull-patches.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";
import type { KnowledgePublicationState } from "./knowledge-publication-state.js";
import { observeBaseChange } from "./knowledge-publication-tracking.js";

/** How far back an incremental read reaches before the last change it saw, for clock skew. */
const HISTORY_OVERLAP_MS = 10 * 60_000;
/** How many unreachable pull request heads a failure names. */
const NAMED_MISSING = 5;

/**
 * ADR-0607: what is already published or decided, read from GitHub before anything is published.
 * A local knowledge commit is published when its patch is among the commits a merged pull request
 * of the branch carried, by anyone and by any method, as GitHub's own pull request head shows
 * them, unless its parent already contains that merge's commit: then it was built after the merge.
 * No clock is read. A host switch or lost state gives the same answer, and so do pull requests
 * merged before Lervo wrote records. Pull requests a person closed without merge hold their
 * commits back. The history is read incrementally and cached per repository.
 */
export async function readKnowledgePublicationStanding(input: {
  root: string;
  settings: KnowledgePublicationSettings;
  forge: KnowledgePublicationForge;
  hostHash: string;
  superseded: ReadonlySet<string>;
  /** Grows in place with every commit GitHub shows published. */
  published: Set<string>;
  state: KnowledgePublicationState;
  /** What a previous cycle cached; its history counts only for the same repository. */
  cache: KnowledgePublicationHistoryCache | null;
}): Promise<{
  inventory: KnowledgePublicationInventory;
  /** Records a merge this cycle made, so a later offline cycle compares with its merge commit. */
  recordMerge: (lastMerged: NonNullable<KnowledgePublicationHistory["lastMerged"]>) => void;
  /**
   * Keys the cache to where the local base and head are after this publication, which a merge's
   * catch-up or a supersession may have moved, so the next cycle needs no GitHub read for it.
   */
  refresh: () => Promise<void>;
}> {
  const { root, settings, forge } = input;
  const repository = await step("knowledge_publication_pull_request_failed", () =>
    forge.repository(),
  );
  const cached = input.cache?.repository === repository ? input.cache.history : null;
  const since =
    cached?.through === null || cached === null
      ? undefined
      : new Date(Date.parse(cached.through) - HISTORY_OVERLAP_MS).toISOString();
  const fetched = await step("knowledge_publication_pull_request_failed", () =>
    forge.publicationHistory({
      head: settings.branch,
      base: settings.baseBranch,
      ...(since === undefined ? {} : { since }),
    }),
  );
  // A newer read of a pull request replaces the cached one, and one reopened since is open, so it
  // leaves the closed history until it closes again.
  const byNumber = new Map((cached?.pullRequests ?? []).map((entry) => [entry.number, entry]));
  for (const entry of fetched)
    if (entry.open === true) byNumber.delete(entry.number);
    else byNumber.set(entry.number, entry);
  const entries = [...byNumber.values()];
  const inventoryWith = (excluded: ReadonlySet<string>) =>
    step("knowledge_publication_fetch_failed", async () => {
      const value = await inventoryKnowledgePublication(root, settings, excluded, input.published);
      if (value === null)
        throw new PublicationFailure("knowledge_publication_fetch_failed", "base branch absent");
      return value;
    });
  // What Git alone leaves unpublished is what GitHub's pull requests are asked about.
  const first = await inventoryWith(input.superseded);
  const local = await step("knowledge_publication_inspect_failed", () =>
    localPatches(root, first.candidateCommits),
  );
  // Patch ids are cached by pull request and head: a pull request closed again at a new head is
  // read again.
  const patchKey = (entry: { number: number; headSha: string }) =>
    `${entry.number}:${entry.headSha}`;
  const known = new Map(
    entries.flatMap((entry) => {
      const patches = cached?.pullPatches[patchKey(entry)];
      return patches === undefined ? [] : [[entry.number, patches] as const];
    }),
  );
  const unscanned = entries.filter(
    (entry) => !known.has(entry.number) && (entry.merged || !closedByLervo(entry)),
  );
  const scanned =
    local.size === 0 || unscanned.length === 0
      ? { patches: new Map<number, string[]>(), missing: [] as number[] }
      : await step("knowledge_publication_inspect_failed", () =>
          pullRequestPatchIds({ root, settings, base: first.base, pullRequests: unscanned }),
        );
  // ADR-0607: a merged pull request whose head GitHub does not serve cannot prove what it
  // carried, so nothing is published until it can, and the failure names it.
  const missingMerged = scanned.missing.filter((number) => byNumber.get(number)?.merged === true);
  // It is retried at the transient backoff, then stays named attention until GitHub serves it.
  if (missingMerged.length > 0) {
    const named = missingMerged.slice(0, NAMED_MISSING).map((number) => `refs/pull/${number}/head`);
    const more = missingMerged.length - named.length;
    throw new PublicationFailure(
      "knowledge_publication_pull_head_unavailable",
      `${named.join(", ")}${more > 0 ? ` and ${more} more` : ""} unavailable`,
      { transient: true },
    );
  }
  const carried = new Map([...known, ...scanned.patches]);
  const patches = new Set([...local.values()].map((item) => item.patch));
  const closures = new Map<number, KnowledgePublicationClosure>();
  for (const entry of entries)
    if (
      !entry.merged &&
      !closedByLervo(entry) &&
      (carried.get(entry.number) ?? []).some((patch) => patches.has(patch))
    )
      closures.set(
        entry.number,
        await step("knowledge_publication_pull_request_failed", () =>
          forge.closureCause(entry.number),
        ),
      );
  // ADR-0607: a commit built on a pull request's merge commit came after it, whatever its patch.
  const pairs = [...local].flatMap(([sha, item]) =>
    entries
      .filter((entry) => entry.merged && (carried.get(entry.number) ?? []).includes(item.patch))
      .map((entry) => ({ sha, number: entry.number, mergeCommit: entry.mergeCommit })),
  );
  const after = await step("knowledge_publication_inspect_failed", () =>
    builtAfterMerges(root, pairs),
  );
  // A closed head GitHub does not serve still holds back what its record names.
  const recorded = new Map(
    scanned.missing.map((number) => [
      number,
      parseKnowledgePublicationRecord(byNumber.get(number)?.record ?? "")?.commits ?? [],
    ]),
  );
  for (const number of recorded.keys()) {
    const entry = byNumber.get(number);
    if (entry !== undefined && !entry.merged && !closedByLervo(entry) && !closures.has(number))
      closures.set(
        number,
        await step("knowledge_publication_pull_request_failed", () => forge.closureCause(number)),
      );
  }
  const history = deriveKnowledgePublicationHistory({
    entries,
    carried,
    local,
    after,
    closures,
    recorded,
  });
  for (const sha of history.published) input.published.add(sha);
  const closed = history.declined;
  const inventory = await inventoryWith(
    new Set([...input.superseded, ...closed.flatMap((item) => item.commits)]),
  );
  // A merged pull request whose merge commit is not reported yet is read again later.
  const settled = new Set(
    entries
      .filter((entry) => !entry.merged || entry.mergeCommit !== null)
      .map((entry) => entry.number),
  );
  const pullPatches = Object.fromEntries(
    [...carried]
      .filter(([number]) => settled.has(number))
      .map(([number, ids]) => [patchKey(byNumber.get(number)!), ids]),
  );
  const through =
    entries
      .map((entry) => entry.updatedAt)
      .sort()
      .at(-1) ??
    cached?.through ??
    null;
  // A cached merged entry keeps only Lervo's closure mark of its record; an unmerged one keeps its
  // record, which names what a person declined if GitHub stops serving its head.
  const pullRequests = entries.map((entry) => ({
    ...entry,
    record: entry.merged ? "" : entry.record,
    closedByLervo: closedByLervo(entry),
  }));
  // Only commits still in `base..head` matter, so nothing here needs a cap.
  const declinedIn = (range: ReadonlySet<string>) =>
    closed
      .map((item) => ({ ...item, commits: item.commits.filter((sha) => range.has(sha)) }))
      .filter((item) => item.commits.length > 0);
  const declined = declinedIn(new Set(inventory.rangeCommits));
  // The cache is only a convenience; failing to write it costs one more GitHub read.
  const cache = (
    lastMerged: KnowledgePublicationHistory["lastMerged"],
    at: { base: string; head: string; range: ReadonlySet<string> },
  ) =>
    writeKnowledgePublicationHistoryCache(root, {
      schemaVersion: 2,
      repository,
      history: { through, pullRequests, pullPatches },
      local: {
        hostHash: input.hostHash,
        base: at.base,
        head: at.head,
        published: [...input.published].filter((sha) => at.range.has(sha)),
        declined: declinedIn(at.range),
        lastMerged,
      },
    }).then(
      ({ historyDropped }) => {
        // ADR-0607: a history too large to cache is read whole each cycle, and reported.
        if (historyDropped) input.state.historyUncached = true;
        else delete input.state.historyUncached;
      },
      () => undefined,
    );
  await cache(history.lastMerged, {
    base: inventory.base,
    head: inventory.head,
    range: new Set(inventory.rangeCommits),
  });
  observe(input.state, declined, await observeBaseChange(root, inventory.base, history.lastMerged));
  let lastMerged = history.lastMerged;
  const refresh = async () => {
    const base = await remoteTrackingHead(root, settings, settings.baseBranch).catch(() => null);
    const head = (await git(root, ["rev-parse", "HEAD"], "inspect").catch(() => "")).trim();
    if (base === null || head === "") return;
    const range = (await git(root, ["rev-list", `${base}..${head}`], "inspect").catch(() => ""))
      .split("\n")
      .filter((sha) => sha !== "");
    await cache(lastMerged, { base, head, range: new Set(range) });
  };
  return {
    inventory,
    recordMerge: (merged) => {
      lastMerged = merged;
    },
    refresh,
  };
}

export function withoutWait(state: KnowledgePublicationState): KnowledgePublicationState {
  const { wait: _wait, ...rest } = state;
  return rest;
}

/**
 * Records the owner decisions the history shows: pull requests closed without merge whose commits
 * are still local (null keeps them), and the base change of the newest merge (undefined keeps it).
 */
export function observe(
  state: KnowledgePublicationState,
  declined: KnowledgePublicationDeclined[] | null,
  changed: KnowledgePublicationState["baseChanged"] | null | undefined,
): void {
  if (declined !== null && declined.length > 0)
    state.declined = declined.map((item) => ({
      pullRequestNumber: item.pullRequestNumber,
      commitCount: item.commits.length,
    }));
  else if (declined !== null) delete state.declined;
  if (changed === null) delete state.baseChanged;
  else if (changed !== undefined) state.baseChanged = changed;
}

/** The legacy ledger, the wait and the owner decisions a new attempt starts from. */
export function carriedState(
  previous: KnowledgePublicationState | null,
): Partial<KnowledgePublicationState> {
  if (previous === null) return {};
  const { publishedCommits, wait, declined, baseChanged } = previous;
  return {
    ...(publishedCommits === undefined ? {} : { publishedCommits }),
    ...(wait === undefined ? {} : { wait }),
    ...(declined === undefined ? {} : { declined }),
    ...(baseChanged === undefined ? {} : { baseChanged }),
  };
}
