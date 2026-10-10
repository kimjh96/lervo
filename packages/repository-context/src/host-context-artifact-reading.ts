import { canonicalHash } from "@lervo/search";
import { verifyHostArtifact } from "./host-context-artifact.js";
import type { RepositoryQualityInput } from "./repository-quality-context.js";
import type { HostContextOutcomeInput, HostOutcomeContract } from "./host-context-outcome-types.js";

/** Resolves and reads one artifact; correction and completion remain with the effect owner. */
export async function readHostContextArtifact(
  input: HostContextOutcomeInput,
  preparation: RepositoryQualityInput,
  artifact: HostContextOutcomeInput["artifacts"][number],
  planDigest: string,
  language: string,
) {
  let required = Boolean(input.policy);
  try {
    const contract: HostOutcomeContract = input.policy
      ? await input.policy.resolve({
          planDigest,
          artifact,
          preparation: { ...preparation, task: structuredClone(preparation.task) },
        })
      : {
          definition: {
            definitionId: "host.observed-outcome.v1",
            language,
            preserveProtectedMaterial: artifact.kind === "repository",
            task: {
              definitionId: "host.task.v1",
              taskDigest: canonicalHash(input.task),
              checks: [
                {
                  checkId: "task_acceptance",
                  requirement:
                    "Verify every applicable task requirement against this exact artifact. Missing accepted criteria or evidence is unavailable.",
                },
              ],
            },
          },
          isPublication: artifact.kind === "repository" && /\.md$/iu.test(artifact.path),
          requirePassed: false,
        };
    required = contract.requirePassed;
    const observation = await verifyHostArtifact({
      preparation,
      planDigest,
      artifact,
      contract,
    });
    return { status: "observed" as const, required, contract, observation };
  } catch (error) {
    return { status: "unavailable" as const, required, error };
  }
}
