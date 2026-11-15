import { sha256 } from "@lervo/repository-knowledge";
import type { CanonicalDraft } from "./canonical-assessment-contract.js";
import { convergenceGit } from "./canonical-workspace.js";
import { restoreDiscardedIntegratedDrafts, workingTreeHash } from "./integration-target-discard.js";
import { resolveIntegrationTarget } from "./integration-target-sync.js";
import { committedBlobHashes } from "./committed-blob-hashes.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Retire only exact, proven ref drafts that never reached root apply, using ADR-0530's CAS restoration. */
export async function retireCapacityBlockedRefDrafts(input: {
  repositoryRoot: string;
  ref: string;
  target: string;
  drafts: readonly CanonicalDraft[];
  /** The caller has verified the retained integration proof and rechecks its delegation and source lease. */
  assertCurrent(): Promise<void>;
  /** An exact source fence, run immediately before the restoring ref write. */
  fenceRefWrite?: () => void;
}) {
  const root = input.repositoryRoot;
  await input.assertCurrent();
  if ((await resolveIntegrationTarget(root, input.ref)) !== input.target)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  const targetHashes = await committedBlobHashes(
    root,
    input.target,
    input.drafts.map((draft) => draft.path),
  );
  for (const draft of input.drafts) {
    if (
      (await workingTreeHash(root, draft.path)) !== draft.beforeHash ||
      (targetHashes.get(draft.path) ?? null) !== sha256(draft.content)
    )
      throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  }
  const head = await convergenceGit(root, ["rev-parse", "HEAD"]);
  const drafts = new Map(input.drafts.map((draft) => [draft.path, sha256(draft.content)]));
  await input.assertCurrent();
  const paths = await restoreDiscardedIntegratedDrafts({
    repositoryRoot: root,
    ref: input.ref,
    target: input.target,
    head,
    integrated: (path, hash) => drafts.get(path) === hash,
    ...(input.fenceRefWrite === undefined ? {} : { fenceRefWrite: input.fenceRefWrite }),
  }).catch(async (error: unknown) => {
    if ((await resolveIntegrationTarget(root, input.ref)) !== input.target)
      throw new KnowledgeConvergenceRuntimeError("source_bytes_changed", { cause: error });
    throw error;
  });
  const after = await resolveIntegrationTarget(root, input.ref);
  if (after === null) throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  if (
    paths.length === 0
      ? after !== input.target
      : (await convergenceGit(root, ["rev-parse", `${after}^`])) !== input.target
  )
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  return { ref: input.ref, before: input.target, after, paths };
}
