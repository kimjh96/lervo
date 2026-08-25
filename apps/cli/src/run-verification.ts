import { captureRepositorySnapshot, type ManagedProjectVerifier } from "@lervo/orchestrator";
import type { ArtifactStore } from "@lervo/storage-contract";
import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";

export interface PreparedRunVerification {
  suites: Awaited<ReturnType<typeof loadVerificationSuite>>[];
  verifier: ManagedProjectVerifier;
}

export async function prepareRunVerification(input: {
  repositoryRoot: string;
  suiteIds: readonly string[];
  artifactStore: ArtifactStore;
  now?: () => Date;
}): Promise<PreparedRunVerification> {
  const suites = [];
  for (const suiteId of input.suiteIds) {
    suites.push(await loadVerificationSuite(input.repositoryRoot, suiteId));
  }
  return {
    suites,
    verifier: {
      verify: async ({ suite, repositoryRoot, repositoryRevision, signal }) =>
        runVerificationSuite(
          {
            suite,
            repositoryRoot,
            repositoryRevision,
            captureRepositoryRevision: async (root) =>
              (await captureRepositorySnapshot(root)).revision,
            artifactStore: input.artifactStore,
            ...(signal === undefined ? {} : { signal }),
          },
          input.now === undefined ? {} : { now: input.now },
        ),
    },
  };
}
