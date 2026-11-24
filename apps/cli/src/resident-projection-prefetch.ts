import { canonicalJson } from "@lervo/repository-knowledge";
import { repositoryHeadIdentity } from "@lervo/repository-knowledge-runtime";

import { prefetchRepositoryHealth } from "./repository-health-prefetch.js";
import {
  cachedKnowledgeSnapshotRevision,
  terminalKnowledgeSnapshotId,
} from "./terminal-knowledge-snapshot.js";

/** Per checkout: the commit identity whose prompt snapshot is cached. */
const prefetched = new Map<string, string>();
/** One scan at a time per process: a scan is about 10 seconds of one shared thread. */
let scanning = false;

/**
 * What a commit, checkout or reset moves: HEAD, the ref it names, and packed refs. The index is
 * left out because `git status` and `git add` rewrite it without changing the bytes a scan reads.
 */
function commitIdentity(root: string): string | null {
  try {
    const { head, ref, packedRefs } = repositoryHeadIdentity(root) as Record<string, unknown>;
    return canonicalJson({ head, ref, packedRefs });
  } catch {
    return null;
  }
}

/**
 * The rebuildable projections a resident refreshes after a change: the repository health, then,
 * once a commit moved HEAD, the knowledge snapshot the next compact prompt reads. Stop prefetches
 * that snapshot for each turn's final bytes; a resident commit afterwards moved the revision, and
 * the next prompt paid a full knowledge scan (about 10 seconds on this repository), past the hook
 * budget. The scan reuses the revision the health refresh captured (ADR-0601: one repository
 * walk), runs only for a checkout that has been prompted (its snapshot cache exists), runs one at
 * a time per process, and is not awaited by the refresh, the cycle, or `stop()`. A commit counts
 * as handled only once the cache holds its revision, so a scan whose result a concurrent edit
 * kept out of the cache is tried again at the next refresh. Working-tree edits alone leave HEAD
 * unchanged and rely on Stop's prefetch.
 */
export async function prefetchResidentProjections(root: string): Promise<void> {
  // Read before the health walk, so a commit during it is never credited to the older revision.
  const commit = commitIdentity(root);
  const revision = await prefetchRepositoryHealth(root);
  if (commit === null || prefetched.get(root) === commit || scanning) return;
  const cached = await cachedKnowledgeSnapshotRevision(root).catch(() => null);
  if (cached === null) return;
  if (cached === revision) {
    prefetched.set(root, commit);
    return;
  }
  scanning = true;
  void terminalKnowledgeSnapshotId(root, revision)
    .then(async () => {
      if ((await cachedKnowledgeSnapshotRevision(root)) === revision) prefetched.set(root, commit);
    })
    // A failed scan costs only the next prompt's scan; the next refresh tries again.
    .catch(() => undefined)
    .finally(() => {
      scanning = false;
    });
}
