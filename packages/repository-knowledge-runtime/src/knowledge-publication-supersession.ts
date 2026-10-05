import { git, tracking, type KnowledgePublicationInventory } from "./knowledge-publication-git.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";

/** Backup refs keep superseded knowledge commits reachable; only the newest few are retained. */
const KNOWLEDGE_SUPERSEDED_REF_PREFIX = "refs/lervo/knowledge-superseded/";
const RETAINED_BACKUP_REFS = 8;

export interface KnowledgeSupersession {
  /** The ref that now points at the local head holding the superseded commits. */
  backupRef: string;
  /** True when the local base branch moved to the remote base, so convergence runs again there. */
  localReset: boolean;
}

/**
 * Retires knowledge commits whose replay onto the current remote base conflicted: their outputs
 * were computed against stale source bytes, so they are never published. The local head is kept
 * under a backup ref first. The local base branch then moves to the remote base with
 * `reset --keep` only when it is checked out and holds no developer work, so nothing unpublished
 * is lost and uncommitted edits survive; the next convergence cycle regenerates the outputs
 * against the current base. Otherwise the branch is left for its owner to rebase.
 */
export async function supersedeStaleKnowledgeCommits(
  root: string,
  settings: KnowledgePublicationSettings,
  inventory: KnowledgePublicationInventory,
): Promise<KnowledgeSupersession> {
  const backupRef = `${KNOWLEDGE_SUPERSEDED_REF_PREFIX}${inventory.head.slice(0, 12)}`;
  await git(root, ["update-ref", backupRef, inventory.head], "supersede");
  await pruneBackupRefs(root);
  if (inventory.developerCount > 0) return { backupRef, localReset: false };
  const branch = (
    await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], "supersede").catch(() => "")
  ).trim();
  const head = (await git(root, ["rev-parse", "HEAD"], "supersede")).trim();
  // A head that moved since the inventory may hold newer work; leave it for the next cycle.
  if (branch !== settings.baseBranch || head !== inventory.head)
    return { backupRef, localReset: false };
  const reset = await git(
    root,
    ["reset", "--keep", "--quiet", tracking(settings, settings.baseBranch)],
    "supersede",
  ).then(
    () => true,
    () => false,
  );
  return { backupRef, localReset: reset };
}

async function pruneBackupRefs(root: string): Promise<void> {
  const refs = (
    await git(
      root,
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname)",
        KNOWLEDGE_SUPERSEDED_REF_PREFIX,
      ],
      "supersede",
    )
  )
    .split("\n")
    .filter((ref) => ref !== "");
  for (const ref of refs.slice(RETAINED_BACKUP_REFS))
    await git(root, ["update-ref", "-d", ref], "supersede");
}
