import {
  KNOWLEDGE_PUBLICATION_TITLE,
  renderKnowledgePublicationBody,
} from "./knowledge-publication-body.js";
import { step } from "./knowledge-publication-failure.js";
import type {
  KnowledgePublicationForge,
  KnowledgePublicationPullRequest,
} from "./knowledge-publication-forge.js";
import {
  pushKnowledgePublicationTip,
  remoteTrackingHead,
  type KnowledgePublicationInventory,
} from "./knowledge-publication-git.js";
import type { KnowledgeOutputFormatter } from "./knowledge-output-formatter.js";
import type { KnowledgePublicationMergeMethod } from "./knowledge-publication-policy.js";
import { samePublishedChange } from "./knowledge-publication-pull-patches.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";
import {
  buildKnowledgePublicationTip,
  equivalentPublishedHead,
} from "./knowledge-publication-tip.js";

/**
 * Builds the publication tip on the current base, keeps or pushes the head, and opens or updates
 * the pull request whose body records it. A replay that conflicts publishes nothing; the caller
 * supersedes those commits.
 */
export async function openKnowledgePublicationHead(input: {
  root: string;
  settings: KnowledgePublicationSettings;
  forge: KnowledgePublicationForge;
  inventory: KnowledgePublicationInventory;
  formatter: () => Promise<KnowledgeOutputFormatter | null>;
  host: { hostHash: string; hostLabel: string };
  method: KnowledgePublicationMergeMethod | "queue" | null;
}): Promise<
  | { status: "conflict"; conflictPathCount: number }
  | { status: "opened"; tip: string; pullRequest: KnowledgePublicationPullRequest }
> {
  const { root, settings, forge, inventory } = input;
  const built = await step("knowledge_publication_conflict", async () =>
    buildKnowledgePublicationTip(root, inventory, await input.formatter()),
  );
  if (built.status === "conflict")
    return { status: "conflict", conflictPathCount: built.conflictPathCount };
  const existing = await step("knowledge_publication_pull_request_failed", () =>
    forge.findPullRequest({ head: settings.branch, base: settings.baseBranch }),
  );
  // Unchanged content keeps the published head, so its checks are not restarted.
  const tip = await step("knowledge_publication_push_failed", async () => {
    const remoteHead = await remoteTrackingHead(root, settings, settings.branch);
    const published = await equivalentPublishedHead(root, inventory.base, built.tip, remoteHead);
    if (published !== null) return published;
    // ADR-0603: a base move alone pushes nothing. The open pull request keeps its head while it
    // carries the same change, so a busy base neither restarts its checks nor dismisses its
    // reviews; only a gate that needs a new head, `behind` or `conflict`, rebuilds it.
    if (
      existing !== null &&
      remoteHead !== null &&
      existing.headSha === remoteHead &&
      (await samePublishedChange(root, inventory.base, built.tip, remoteHead))
    ) {
      const gate = await step("knowledge_publication_merge_failed", () =>
        forge.gate(existing.number),
      );
      if (gate !== "behind" && gate !== "conflict") return remoteHead;
    }
    await pushKnowledgePublicationTip(root, settings, built.tip, remoteHead);
    return built.tip;
  });
  const body = renderKnowledgePublicationBody({
    commits: inventory.knowledge,
    settings,
    host: input.host,
    rebuilt: built.replayed,
    formattedPathCount: built.formattedPathCount,
    head: tip,
    method: input.method,
  });
  // ADR-0607: the body's record must name the pushed head before anything merges, so a failed
  // update fails this step and is tried again. People and Lervo's closure mark read it; it never
  // makes a commit published.
  const pullRequest = await step("knowledge_publication_pull_request_failed", async () => {
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
  return { status: "opened", tip, pullRequest };
}
