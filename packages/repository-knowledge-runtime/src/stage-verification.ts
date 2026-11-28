import { convergenceSourceObservation } from "./source-observation.js";
import { assertConvergenceVerificationPassed } from "./verification-outcome.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { withVerificationSourceChanges } from "./verification-source-changes.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";
import {
  runConvergenceVerificationSuite,
  verificationEnvironment,
} from "./verification-environment.js";
import { loadConvergenceSuite } from "./default-knowledge-suite.js";

export async function verifyConvergenceEffect(
  context: ConvergenceRuntimeContext,
  authority: ConvergenceAssignmentAuthority,
  policyHash: string,
): Promise<string[]> {
  const root = context.storage.paths.repositoryRoot;
  const sources = convergenceSourceObservation(context);
  // Verification evidence binds exact bytes, so it never reuses a validated observation.
  const observe = async () => {
    const capture = sources.exact(policyHash);
    return {
      revision: capture.snapshotHash,
      files: new Map(capture.sources.map((source) => [source.path, source.contentHash])),
    };
  };
  const receipts: string[] = [];
  const environment = await verificationEnvironment();
  for (const binding of authority.delegation.verification) {
    await authority.assertCurrent();
    const suite = await loadConvergenceSuite(root, binding.suiteId);
    const repositoryRevision = (await observe()).revision;
    const verification = await withVerificationSourceChanges(
      context.storage.artifacts,
      observe,
      (captureRepositoryRevision) =>
        runConvergenceVerificationSuite(
          {
            suite,
            repositoryRoot: root,
            repositoryRevision,
            captureRepositoryRevision,
            artifactStore: context.storage.artifacts,
            signal: context.signal,
          },
          environment,
        ),
    );
    assertConvergenceVerificationPassed(
      verification.result,
      verification.resultArtifact.contentHash,
    );
    receipts.push(verification.resultArtifact.contentHash);
  }
  await authority.assertCurrent();
  return receipts;
}
