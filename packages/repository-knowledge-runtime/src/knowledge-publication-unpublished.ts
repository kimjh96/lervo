import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import { inventoryKnowledgePublication } from "./knowledge-publication-git.js";
import { readKnowledgePublicationHistoryCache } from "./knowledge-publication-history.js";
import { DEFAULT_KNOWLEDGE_PUBLICATION_BRANCH } from "./knowledge-publication-readiness.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";
import {
  KNOWLEDGE_PUBLICATION_STATE_PATH,
  readKnowledgePublicationState,
} from "./knowledge-publication-state.js";
import { readKnowledgeSupersessionLedger } from "./knowledge-supersession-ledger.js";

/** The remote branch a checkout follows, such as `main` on `origin`. */
export interface KnowledgePublicationBase {
  readonly remote: string;
  readonly branch: string;
}

/**
 * The knowledge commits this checkout holds that the resident has not published yet, oldest
 * first, counted exactly as the resident counts them (ADR-0603): non-merge commits that the
 * `Lervo Knowledge` identity both authored and committed, whose patch `base` lacks, and that no
 * merged publication carried, no replay conflict superseded, and no person declined. It reads
 * only local state, never GitHub: the publication state, the supersession ledger, and the local
 * part of the history cache for this host. `base` names the remote-tracking branch to compare
 * with, which the caller has fetched.
 *
 * Returns null when the publication state exists but cannot be read, because then nothing says
 * which commits a person declined or a conflict superseded. Throws when Git cannot list the range.
 */
export async function unpublishedKnowledgeCommits(
  root: string,
  base: KnowledgePublicationBase,
): Promise<string[] | null> {
  const statePresent = await lstat(resolve(root, KNOWLEDGE_PUBLICATION_STATE_PATH)).then(
    () => true,
    () => false,
  );
  const state = await readKnowledgePublicationState(root);
  if (statePresent && state === null) return null;
  const host = await readConvergenceOwnerHost(root).catch(() => null);
  const cache = await readKnowledgePublicationHistoryCache(root);
  // ADR-0607: the local part of the cache answers only for the host that derived it.
  const local = host !== null && cache?.local?.hostHash === host.hostHash ? cache.local : null;
  const ledger = await readKnowledgeSupersessionLedger(root);
  const excluded = new Set([
    ...(state?.supersededCommits ?? []),
    ...ledger.entries.map((entry) => entry.commit),
    ...(local?.declined ?? []).flatMap((item) => item.commits),
  ]);
  const published = new Set([...(local?.published ?? []), ...(state?.publishedCommits ?? [])]);
  // The inventory reads only the remote and base branch; nothing here publishes.
  const settings: KnowledgePublicationSettings = {
    remote: base.remote,
    baseBranch: base.branch,
    branch: DEFAULT_KNOWLEDGE_PUBLICATION_BRANCH,
    merge: "never",
    scope: "delegation",
  };
  const inventory = await inventoryKnowledgePublication(root, settings, excluded, published);
  if (inventory === null) throw new Error(`refs/remotes/${base.remote}/${base.branch} is missing.`);
  return inventory.candidateCommits;
}
