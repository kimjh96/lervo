import { ContextQualityError, readRepositoryFile } from "@lervo/context";
import { sha256 } from "@lervo/repository-knowledge";
import { evaluateContextOutcomeBytes } from "./context-outcome-evaluation.js";
import { freezeOutcomeInput } from "./context-outcome-types.js";
import { repositoryOutcomeInput } from "./repository-context-outcome.js";
import { verifyRepositoryContextOutcome } from "./repository-context-outcome.js";
import type { HostOutcomeArtifact, HostOutcomeContract } from "./host-context-outcome-types.js";
import type { RepositoryQualityInput } from "./repository-quality-context.js";

export async function verifyHostArtifact(input: {
  preparation: RepositoryQualityInput;
  planDigest: string;
  artifact: HostOutcomeArtifact;
  contract: HostOutcomeContract;
}) {
  const { preparation, planDigest, artifact, contract } = input;
  const common = {
    preparation,
    planDigest,
    definition: contract.definition,
    isPublication: contract.isPublication,
    ...(contract.evaluator ? { evaluator: contract.evaluator } : {}),
    ...(contract.taskEvaluator ? { taskEvaluator: contract.taskEvaluator } : {}),
    ...(contract.authorizeLanguageException
      ? { authorizeLanguageException: contract.authorizeLanguageException }
      : {}),
  };
  if (artifact.kind === "repository") {
    if (
      artifact.expectedDigest &&
      sha256(await readRepositoryFile(preparation.repositoryRoot, artifact.path, 1048576)) !==
        artifact.expectedDigest
    )
      throw new ContextQualityError("context_binding_stale");
    const observed = await verifyRepositoryContextOutcome({
      ...common,
      artifactPath: artifact.path,
      ...(artifact.baselineBytes ? { baselineBytes: artifact.baselineBytes } : {}),
    });
    if (artifact.expectedDigest && observed.artifactDigest !== artifact.expectedDigest)
      throw new ContextQualityError("context_binding_stale");
    return observed;
  }
  if (
    !/^art_[A-Za-z0-9_-]+$/u.test(artifact.artifactId) ||
    artifact.artifactId.length > 128 ||
    !Number.isInteger(artifact.byteCount) ||
    artifact.byteCount < 0 ||
    artifact.byteCount > 1048576
  )
    throw new TypeError("Invalid immutable outcome coordinate.");
  const read = async () => {
    const bytes = new Uint8Array(await artifact.readBytes());
    if (bytes.byteLength !== artifact.byteCount || sha256(bytes) !== artifact.contentHash)
      throw new ContextQualityError("context_binding_stale");
    return bytes;
  };
  const bytes = await read();
  return evaluateContextOutcomeBytes(
    freezeOutcomeInput(
      repositoryOutcomeInput({ ...common, artifactPath: `artifacts/${artifact.artifactId}` }),
    ),
    bytes,
    async () => {
      await read();
    },
  );
}
