import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";
import { captureConvergenceSources } from "./source-capture.js";
import { assertConvergenceVerificationPassed } from "./verification-outcome.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { withVerificationSourceChanges } from "./verification-source-changes.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";

export async function verifyConvergenceEffect(
  context: ConvergenceRuntimeContext,
  authority: ConvergenceAssignmentAuthority,
  policyHash: string,
): Promise<string[]> {
  const root = context.storage.paths.repositoryRoot;
  const observe = async () => {
    const capture = captureConvergenceSources(root, policyHash);
    return {
      revision: capture.snapshotHash,
      files: new Map(capture.sources.map((source) => [source.path, source.contentHash])),
    };
  };
  const receipts: string[] = [];
  for (const binding of authority.delegation.verification) {
    await authority.assertCurrent();
    const suite = await loadVerificationSuite(root, binding.suiteId);
    const repositoryRevision = (await observe()).revision;
    const verification = await withVerificationSourceChanges(
      context.storage.artifacts,
      observe,
      (captureRepositoryRevision) =>
        runVerificationSuite({
          suite,
          repositoryRoot: root,
          repositoryRevision,
          captureRepositoryRevision,
          artifactStore: context.storage.artifacts,
          signal: context.signal,
        }),
    );
    assertConvergenceVerificationPassed(verification.result.status);
    receipts.push(verification.resultArtifact.contentHash);
  }
  await authority.assertCurrent();
  return receipts;
}
