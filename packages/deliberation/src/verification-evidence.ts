import { validateVerificationResult, verificationResultBytes } from "@lervo/verification-contract";

import { deliberationSha256 } from "./integrity.js";
import { DeliberationError, type DeliberationVerificationEvidence } from "./types.js";

export function verificationEvidenceById(
  evidence: readonly DeliberationVerificationEvidence[],
): Map<string, DeliberationVerificationEvidence> {
  const result = new Map<string, DeliberationVerificationEvidence>();
  for (const item of evidence) {
    if (result.has(item.result.verificationId)) {
      throw new DeliberationError(
        "verification_evidence_invalid",
        "verification_evidence_duplicate",
        "Evidence with the same verification ID is duplicated.",
      );
    }
    try {
      validateVerificationResult(item.result, item.suite);
    } catch (error) {
      throw new DeliberationError(
        "verification_evidence_invalid",
        "verification_result_invalid",
        "The verification result linked to the deliberation does not satisfy the suite contract.",
        { cause: error },
      );
    }
    const bytes = verificationResultBytes(item.result);
    const contentHash = deliberationSha256(bytes);
    const digest = contentHash.slice(7);
    if (
      item.resultArtifact.contentHash !== contentHash ||
      item.resultArtifact.artifactId !== `art_${digest}` ||
      item.resultArtifact.uri !== `lervo-cas://sha256/${digest}` ||
      item.resultArtifact.mediaType !==
        "application/vnd.lervo.verification-result+json; charset=utf-8" ||
      item.resultArtifact.byteCount !== bytes.byteLength
    ) {
      throw new DeliberationError(
        "verification_evidence_invalid",
        "verification_coordinate_mismatch",
        "The verification result artifact coordinates differ from the canonical result.",
      );
    }
    result.set(item.result.verificationId, item);
  }
  return result;
}
