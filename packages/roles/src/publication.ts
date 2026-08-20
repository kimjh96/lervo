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
      "역할 산출물은 같은 artifact에 결속된 모든 필수 평가가 통과해야 공개할 수 있습니다.",
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
    throw new RoleContractError("role_publication_blocked", "역할 산출물 CAS 원본을 읽지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== input.result.byteCount || contentHash !== input.result.contentHash) {
    throw new RoleContractError("role_publication_blocked", "역할 산출물 CAS 원본의 크기나 hash가 다릅니다.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new RoleContractError("role_publication_blocked", "역할 산출물이 유효한 UTF-8이 아닙니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
