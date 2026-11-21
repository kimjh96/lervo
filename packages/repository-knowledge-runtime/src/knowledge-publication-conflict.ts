import type { KnowledgePublicationForge } from "./knowledge-publication-forge.js";
import { step } from "./knowledge-publication-failure.js";
import type { KnowledgePublicationInventory } from "./knowledge-publication-git.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";
import {
  MAXIMUM_SUPERSEDED_COMMITS,
  nextKnowledgePublicationFailure,
  type KnowledgePublicationState,
} from "./knowledge-publication-state.js";
import { supersedeStaleKnowledgeCommits } from "./knowledge-publication-supersession.js";
import { recordKnowledgeSupersession } from "./knowledge-supersession.js";

const SUPERSEDED_COMMENT =
  "Closed by the Lervo knowledge publisher: these knowledge commits were computed against an older base and conflict with the current base, so they will not be published. Convergence regenerates the affected outputs against the current base, and the next publication opens a new pull request.";

/** The state without its pull request, which a superseded or vanished publication no longer has. */
export const withoutPullRequest = (state: KnowledgePublicationState): KnowledgePublicationState => {
  const { wait: _wait, ...rest } = state;
  return { ...rest, pullRequestNumber: null, pullRequestUrl: null, publishedHead: null };
};

/**
 * A replay conflict means the commits were computed against stale source bytes. They are never
 * published: they enter the supersession ledger the replica carries to other checkouts, an open
 * publication pull request, which carries only them, is closed, then the local branch is backed
 * up and moved to the remote base when no work can be lost, which requeues convergence there. One `knowledge_publication_superseded` failure records the outcome.
 */
export async function supersedeKnowledgePublication(input: {
  root: string;
  settings: KnowledgePublicationSettings;
  forge: KnowledgePublicationForge;
  previous: KnowledgePublicationState | null;
  base: KnowledgePublicationState;
  progress: { current: KnowledgePublicationState; requeue: boolean; refresh?: () => Promise<void> };
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
