import { knowledgeOutputCommitSafe } from "./knowledge-output-commit.js";
import { git } from "./knowledge-publication-git.js";
import { retainKnowledgeSupersededHead } from "./knowledge-publication-supersession.js";
import {
  commitsReachableFromHead,
  isAncestorCommit,
  knowledgeCommitPatchIds,
  tipKnowledgeCommits,
  type TipKnowledgeCommit,
} from "./knowledge-supersession-git.js";
import {
  mergeKnowledgeSupersessionEntries,
  readKnowledgeSupersessionLedger,
  writeKnowledgeSupersessionLedger,
  type KnowledgeSupersessionEntry,
  type KnowledgeSupersessionHeldReason,
  type KnowledgeSupersessionLedger,
  type KnowledgeSupersessionReconciliation,
} from "./knowledge-supersession-ledger.js";

/**
 * Records the incoming superseded commits and drops every superseded `Lervo Knowledge` commit at
 * the tip of the checked-out branch, so a commit the owner superseded on one host never
 * survives, or returns, through another. A tip commit is superseded when its id is in the ledger
 * or when its patch matches an entry and it does not descend from the base that entry conflicted
 * with (a commit built on that base is a regeneration). Developer commits are never removed: the
 * branch only moves with `reset --keep` to the parent of the superseded run, after the old head
 * is kept under a backup ref. Superseded commits that cannot be dropped are reported as held.
 */
export async function reconcileKnowledgeSupersession(input: {
  repositoryRoot: string;
  incoming?: readonly KnowledgeSupersessionEntry[];
  now?: () => Date;
}): Promise<KnowledgeSupersessionReconciliation> {
  const root = input.repositoryRoot;
  const now = (input.now ?? (() => new Date()))().toISOString();
  const ledger = await readKnowledgeSupersessionLedger(root);
  const entries = mergeKnowledgeSupersessionEntries(ledger.entries, input.incoming ?? []);
  if (entries.length === 0) {
    await persist(root, ledger, { ...ledger, entries, held: null });
    return { entries, dropped: null, held: null };
  }
  const tip = await tipKnowledgeCommits(root);
  const superseded = await supersededTipRun(root, tip, entries);
  let dropped: KnowledgeSupersessionReconciliation["dropped"] = null;
  let blocked: KnowledgeSupersessionHeldReason | null = null;
  if (superseded.length > 0) {
    const drop = await dropTipRun(root, tip[0]!.commit, superseded.at(-1)!.parent);
    if ("reason" in drop) blocked = drop.reason;
    else dropped = { commitCount: superseded.length, backupRef: drop.backupRef };
  }
  const remaining = new Set(
    await commitsReachableFromHead(
      root,
      entries.map((entry) => entry.commit),
    ),
  );
  // Patch-equivalent copies that could not be dropped are held as well, by their own ids.
  if (dropped === null) for (const commit of superseded) remaining.add(commit.commit);
  const held =
    remaining.size === 0
      ? null
      : { reason: blocked ?? ("under_other_work" as const), commits: [...remaining].sort() };
  const previousHeld = ledger.held;
  await persist(root, ledger, {
    schemaVersion: 1,
    entries,
    held:
      held === null
        ? null
        : {
            reason: held.reason,
            commitCount: held.commits.length,
            observedAt:
              previousHeld?.reason === held.reason &&
              previousHeld.commitCount === held.commits.length
                ? previousHeld.observedAt
                : now,
          },
    lastDrop: dropped === null ? ledger.lastDrop : { ...dropped, droppedAt: now },
  });
  return { entries, dropped, held };
}

/** The leading tip commits, newest first, that the ledger marks as superseded. */
async function supersededTipRun(
  root: string,
  tip: readonly TipKnowledgeCommit[],
  entries: readonly KnowledgeSupersessionEntry[],
): Promise<TipKnowledgeCommit[]> {
  const byCommit = new Set(entries.map((entry) => entry.commit));
  const unmatched = tip.filter((commit) => !byCommit.has(commit.commit));
  const patchIds = await knowledgeCommitPatchIds(
    root,
    unmatched.map((commit) => commit.commit),
  );
  const run: TipKnowledgeCommit[] = [];
  for (const commit of tip) {
    if (!byCommit.has(commit.commit) && !(await staleCopy(root, commit, patchIds, entries))) break;
    run.push(commit);
  }
  return run;
}

async function staleCopy(
  root: string,
  commit: TipKnowledgeCommit,
  patchIds: ReadonlyMap<string, string>,
  entries: readonly KnowledgeSupersessionEntry[],
): Promise<boolean> {
  const patchId = patchIds.get(commit.commit);
  for (const entry of entries)
    if (entry.patchId === patchId && !(await isAncestorCommit(root, entry.base, commit.commit)))
      return true;
  return false;
}

async function dropTipRun(
  root: string,
  head: string,
  target: string,
): Promise<{ backupRef: string } | { reason: KnowledgeSupersessionHeldReason }> {
  const branch = await git(root, ["symbolic-ref", "--quiet", "HEAD"], "supersede").then(
    (value) => value.trim(),
    () => "",
  );
  // A head that moved since inspection may hold newer work; the next reconciliation decides.
  const current = (await git(root, ["rev-parse", "HEAD"], "supersede")).trim();
  if (branch === "" || current !== head || !(await knowledgeOutputCommitSafe(root)))
    return { reason: "not_on_branch" };
  const backupRef = await retainKnowledgeSupersededHead(root, head);
  // A replica apply rewrites the index without stat data; `reset --keep` would read every such
  // entry as locally modified. Refreshing only rehashes; it exits nonzero when edits exist.
  await git(root, ["update-index", "-q", "--refresh"], "supersede").catch(() => "");
  const reset = await git(root, ["reset", "--keep", "--quiet", target], "supersede").then(
    () => true,
    () => false,
  );
  return reset ? { backupRef } : { reason: "worktree_conflict" };
}

/** Writes only a changed ledger, so a steady state costs no file write per reconciliation. */
async function persist(
  root: string,
  previous: KnowledgeSupersessionLedger,
  next: KnowledgeSupersessionLedger,
): Promise<void> {
  if (JSON.stringify(previous) !== JSON.stringify(next))
    await writeKnowledgeSupersessionLedger(root, next);
}

/**
 * Ledger entries for knowledge commits a replay conflict just superseded on the owner, so the
 * replica can remove the same commits from every other host.
 */
export async function recordKnowledgeSupersession(input: {
  repositoryRoot: string;
  commits: readonly string[];
  base: string;
  supersededAt: string;
}): Promise<void> {
  const patchIds = await knowledgeCommitPatchIds(input.repositoryRoot, input.commits);
  const ledger = await readKnowledgeSupersessionLedger(input.repositoryRoot);
  // A commit without a diff has no patch id; its own id then matches only itself.
  const recorded = input.commits.map((commit) => ({
    commit,
    patchId: patchIds.get(commit) ?? commit,
    base: input.base,
    supersededAt: input.supersededAt,
  }));
  await persist(input.repositoryRoot, ledger, {
    ...ledger,
    entries: mergeKnowledgeSupersessionEntries(ledger.entries, recorded),
  });
}
