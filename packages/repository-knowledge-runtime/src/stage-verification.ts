import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";
import { captureConvergenceSources } from "./source-capture.js";
import { assertConvergenceVerificationPassed } from "./verification-outcome.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";

export async function verifyConvergenceEffect(
  context: ConvergenceRuntimeContext,
  authority: ConvergenceAssignmentAuthority,
  policyHash: string,
): Promise<string[]> {
  const root = context.storage.paths.repositoryRoot;
  const capture = async () => captureConvergenceSources(root, policyHash).snapshotHash;
  const receipts: string[] = [];
  for (const binding of authority.delegation.verification) {
    await authority.assertCurrent();
    const verification = await runVerificationSuite({
      suite: await loadVerificationSuite(root, binding.suiteId),
      repositoryRoot: root,
      repositoryRevision: await capture(),
      captureRepositoryRevision: capture,
      artifactStore: context.storage.artifacts,
      signal: context.signal,
    });
    assertConvergenceVerificationPassed(verification.result.status);
    receipts.push(verification.resultArtifact.contentHash);
  }
  await authority.assertCurrent();
  return receipts;
}
