import type { RoleEvaluationResult } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { createHash } from "node:crypto";

import { assertRoleEvaluationResult } from "./evaluation.js";
import type { RoleDefinition } from "./types.js";
import { RoleContractError } from "./types.js";

export function assertRoleArtifactPublishable(input: {
  definition: RoleDefinition;
  result: RoleEvaluationResult;
  artifactId: string;
  contentHash: string;
}): void {
  assertRoleEvaluationResult({ definition: input.definition, result: input.result });
  if (input.result.overallStatus !== "passed" ||
    input.result.artifactId !== input.artifactId || input.result.contentHash !== input.contentHash) {
    throw new RoleContractError(
      "role_publication_blocked",
      "A role artifact can be published only after every required evaluation bound to that artifact passes.",
    );
  }
}

export async function readPublishableRoleArtifact(input: {
  definition: RoleDefinition;
  result: RoleEvaluationResult;
  artifactStore: ArtifactStore;
}): Promise<string> {
  assertRoleArtifactPublishable({
    definition: input.definition,
    result: input.result,
    artifactId: input.result.artifactId,
    contentHash: input.result.contentHash,
  });
  const uri = `lervo-cas://sha256/${input.result.contentHash.slice("sha256:".length)}`;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await input.artifactStore.get(uri));
  } catch (error) {
    throw new RoleContractError("role_publication_blocked", "The role artifact CAS source could not be read.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== input.result.byteCount || contentHash !== input.result.contentHash) {
    throw new RoleContractError("role_publication_blocked", "The role artifact CAS source size or hash does not match.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new RoleContractError("role_publication_blocked", "The role artifact is not valid UTF-8.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
