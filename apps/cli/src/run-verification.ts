import { captureRepositorySnapshot, type ManagedProjectVerifier } from "@lervo/orchestrator";
import type { ArtifactStore } from "@lervo/storage-contract";
import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";
import { prepareResearchVerificationEnvironment } from "./research-verification-environment.js";

export interface PreparedRunVerification {
  suites: Awaited<ReturnType<typeof loadVerificationSuite>>[];
  verifier: ManagedProjectVerifier;
}

export async function prepareRunVerification(input: {
  repositoryRoot: string;
  suiteIds: readonly string[];
  artifactStore: ArtifactStore;
  research?: { inputArtifactHash: string; casRoot: string };
  now?: () => Date;
}): Promise<PreparedRunVerification> {
  const suites = [];
  for (const suiteId of input.suiteIds) {
    suites.push(await loadVerificationSuite(input.repositoryRoot, suiteId));
  }
  if (input.research !== undefined) {
    const suite = suites.find((item) => item.suiteId === "role.research.artifact");
    if (suite === undefined)
      throw new Error("Research execution requires its artifact verification suite.");
    await prepareResearchVerificationEnvironment({ suite, ...input.research });
  }
  return {
    suites,
    verifier: {
      verify: async ({ suite, repositoryRoot, repositoryRevision, signal, producedArtifact }) => {
        const research = input.research !== undefined && suite.suiteId === "role.research.artifact";
        if (research && producedArtifact === undefined)
          throw new Error("Research verification requires the exact produced artifact.");
        const environment = research
          ? await prepareResearchVerificationEnvironment({
              suite,
              ...input.research!,
              artifactHash: producedArtifact!.contentHash,
            })
          : undefined;
        return runVerificationSuite(
          {
            suite,
            repositoryRoot,
            repositoryRevision,
            captureRepositoryRevision: async (root) =>
              (await captureRepositorySnapshot(root)).revision,
            artifactStore: input.artifactStore,
            ...(signal === undefined ? {} : { signal }),
          },
          {
            ...(input.now === undefined ? {} : { now: input.now }),
            ...(environment === undefined ? {} : { environment }),
          },
        );
      },
    },
  };
}
