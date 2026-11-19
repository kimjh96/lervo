import { observeToolGeneratedDocuments } from "@lervo/repository-knowledge";

import { loadConvergenceDelegation, pathWithinConvergenceRoots } from "./delegation.js";
import { readFreshnessCandidate } from "./freshness-state-store.js";
import type { KnowledgePublicationCommit } from "./knowledge-publication-git.js";
import {
  DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS,
  type KnowledgePublicationSettings,
} from "./knowledge-publication-settings.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";
import {
  normalizationMayRewrite,
  practiceMaterializationCommit,
} from "./normalization-protected-paths.js";

/** Marks a corrective commit that restores paths; its paths always publish (ADR-0473). */
export const KNOWLEDGE_PUBLICATION_REPAIR_TRAILER = "Lervo-Publication-Repair";

const MANAGED_KNOWLEDGE_ROOT = ".lervo/knowledge/";
const FRESHNESS_TRAILER = /^Lervo-Freshness-(Candidate|Revert): (\S+)$/mu;
const REPAIR_TRAILER = new RegExp(`^${KNOWLEDGE_PUBLICATION_REPAIR_TRAILER}: [0-9a-f]{40}$`, "mu");

/**
 * The write authority one publication checks paths against. `roots` are fixed operator prefixes;
 * `delegation` holds the active delegation's canonical and normalization roots, empty when no
 * delegation is active, and always admits Lervo-managed knowledge state.
 */
export type KnowledgePublicationScope =
  | { source: "roots"; roots: readonly string[] }
  | { source: "delegation"; roots: readonly string[] };

export type KnowledgePublicationViolationReason = "tool_generated" | "outside_scope";

export interface KnowledgePublicationViolation {
  path: string;
  reason: KnowledgePublicationViolationReason;
  /** The unpublished commit whose change of the path decides the violation. */
  commit: string;
}

export function isKnowledgePublicationRepairCommit(
  commit: Pick<KnowledgePublicationCommit, "body">,
) {
  return REPAIR_TRAILER.test(commit.body);
}

export function freshnessCommitCandidate(
  commit: Pick<KnowledgePublicationCommit, "body">,
): { kind: "Candidate" | "Revert"; candidateId: string } | null {
  const match = FRESHNESS_TRAILER.exec(commit.body);
  return match === null
    ? null
    : { kind: match[1] as "Candidate" | "Revert", candidateId: match[2]! };
}

/** Pure: whether the scope admits a path. */
export function knowledgePublicationPathInScope(
  scope: KnowledgePublicationScope,
  path: string,
): boolean {
  if (scope.source === "roots") return scope.roots.some((root) => path.startsWith(root));
  return (
    path.startsWith(MANAGED_KNOWLEDGE_ROOT) ||
    convergenceManagedKnowledgePath(path) ||
    pathWithinConvergenceRoots(path, scope.roots)
  );
}

/**
 * The scope the settings name. The delegation scope reads the checkout's delegation and admits
 * its roots only while it is active and unexpired, so revoking or letting it lapse stops
 * publication of everything except Lervo-managed knowledge state.
 */
export async function loadKnowledgePublicationScope(
  root: string,
  settings: KnowledgePublicationSettings,
  now: Date,
): Promise<KnowledgePublicationScope> {
  if (settings.scope !== "delegation") {
    if (!defaultPublicationRoots(settings.allowedRoots))
      return { source: "roots", roots: settings.allowedRoots };
    // ADR-0594: the default roots Lervo-derived settings hold also admit an active delegation's
    // roots, so publication never refuses what the normalizer was delegated to write.
    const roots = await activeDelegationRoots(root, now);
    return roots.length === 0
      ? { source: "roots", roots: settings.allowedRoots }
      : { source: "delegation", roots: [...new Set([...roots, "docs"])] };
  }
  return { source: "delegation", roots: await activeDelegationRoots(root, now) };
}

function defaultPublicationRoots(roots: readonly string[]): boolean {
  return (
    roots.length === DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS.length &&
    DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS.every((value, index) => roots[index] === value)
  );
}

/** The active, unexpired delegation's canonical and normalization roots; none otherwise. */
async function activeDelegationRoots(root: string, now: Date): Promise<string[]> {
  const loaded = await loadConvergenceDelegation(root).catch(() => null);
  const delegation = loaded?.delegation;
  if (
    delegation === undefined ||
    delegation.state !== "active" ||
    Date.parse(delegation.expiresAt) <= now.getTime()
  )
    return [];
  return [...new Set([...delegation.canonicalRoots, ...delegation.normalizationRoots])];
}

/**
 * A freshness commit carries its own reviewed authority (ADR-0463): the local candidate that
 * applied it must record its commit, or, for a revert, be in the `reverted` state.
 */
async function freshnessCommitAuthorized(
  root: string,
  commit: KnowledgePublicationCommit,
): Promise<boolean> {
  const trailer = freshnessCommitCandidate(commit);
  if (trailer === null) return false;
  const candidate = await readFreshnessCandidate(root, trailer.candidateId).catch(() => null);
  if (candidate === null) return false;
  return trailer.kind === "Candidate"
    ? candidate.commitHash === commit.sha
    : candidate.state === "reverted";
}

/**
 * ADR-0473: the last unpublished knowledge commit that changed a path decides it. A repair commit
 * restores, so it always passes; otherwise a tool-generated path fails, and a path the scope does
 * not admit fails unless a verified freshness commit changed it. Without `toolGenerated`, the
 * repository's tool-ownership evidence for the changed paths is observed.
 */
export async function knowledgePublicationViolations(input: {
  repositoryRoot: string;
  commits: readonly KnowledgePublicationCommit[];
  scope: KnowledgePublicationScope;
  toolGenerated?: ReadonlySet<string>;
}): Promise<KnowledgePublicationViolation[]> {
  const last = new Map<string, KnowledgePublicationCommit>();
  for (const commit of input.commits) for (const path of commit.paths) last.set(path, commit);
  const toolGenerated =
    input.toolGenerated ??
    new Set(
      (
        await observeToolGeneratedDocuments({
          repositoryRoot: input.repositoryRoot,
          paths: [...last.keys()],
        })
      ).keys(),
    );
  const freshness = new Map<string, Promise<boolean>>();
  const violations: KnowledgePublicationViolation[] = [];
  for (const [path, commit] of [...last].sort(([left], [right]) => left.localeCompare(right))) {
    if (isKnowledgePublicationRepairCommit(commit)) continue;
    if (toolGenerated.has(path)) {
      violations.push({ path, reason: "tool_generated", commit: commit.sha });
      continue;
    }
    // ADR-0594: a skill file publishes only from practice materialization, even inside the scope.
    if (
      knowledgePublicationPathInScope(input.scope, path) &&
      (normalizationMayRewrite(path) || practiceMaterializationCommit(commit))
    )
      continue;
    if (!freshness.has(commit.sha))
      freshness.set(commit.sha, freshnessCommitAuthorized(input.repositoryRoot, commit));
    if (await freshness.get(commit.sha)!) continue;
    violations.push({ path, reason: "outside_scope", commit: commit.sha });
  }
  return violations;
}
