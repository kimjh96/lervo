import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  ConceptSidecarCache,
  createRepositoryLayoutMigrationPlan,
  type RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";
import { knowledgeCandidateStoreIdentity } from "@lervo/repository-knowledge-runtime";

/**
 * ADR-0601: a remembered plan is recomputed at least this often, whatever its key says, so an
 * input the key cannot see (such as a path a custom policy reads but the snapshot excludes)
 * reaches health within an hour.
 */
export const HEALTH_LAYOUT_PLAN_MAXIMUM_AGE_MILLISECONDS = 60 * 60_000;

type PlanInput = Parameters<typeof createRepositoryLayoutMigrationPlan>[0];

interface RememberedPlan {
  key: string;
  at: number;
  plan: RepositoryLayoutMigrationPlan;
}

const plans = new Map<string, RememberedPlan>();
const conceptDecoding = new Map<string, unknown>();

/**
 * The layout plan health shows, recomputed only when its inputs change (ADR-0601). The key is the
 * repository snapshot revision, which covers every file the plan scans and every knowledge store
 * under `.lervo/knowledge`, plus the candidate stores under `.lervo/state`, which the snapshot
 * excludes. Any miss recomputes: an unreadable key, a failed plan, or the age bound. A recomputed
 * plan reuses concept decoding by content, so only changed concept files are decoded again.
 */
export async function healthLayoutPlan(input: {
  root: string;
  revision: string;
  now: Date;
  compute?: (input: PlanInput) => Promise<RepositoryLayoutMigrationPlan>;
}): Promise<RepositoryLayoutMigrationPlan | null> {
  const root = resolve(input.root);
  const at = input.now.getTime();
  let key: string | null;
  try {
    key = createHash("sha256")
      .update(JSON.stringify([input.revision, knowledgeCandidateStoreIdentity(root)]))
      .digest("hex");
  } catch {
    key = null;
  }
  const remembered = plans.get(root);
  if (
    key !== null &&
    remembered?.key === key &&
    at >= remembered.at &&
    at - remembered.at < HEALTH_LAYOUT_PLAN_MAXIMUM_AGE_MILLISECONDS
  )
    return remembered.plan;
  const conceptCache = new ConceptSidecarCache(conceptDecoding.get(root) ?? null);
  const plan = await (input.compute ?? createRepositoryLayoutMigrationPlan)({
    repositoryRoot: root,
    conceptCache,
  }).catch(() => null);
  const decoding = conceptCache.snapshot();
  if (decoding !== null) conceptDecoding.set(root, decoding);
  if (key === null || plan === null) plans.delete(root);
  else plans.set(root, { key, at, plan });
  return plan;
}
