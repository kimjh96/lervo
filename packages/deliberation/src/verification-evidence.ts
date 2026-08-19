import {
  validateVerificationResult,
  verificationResultBytes,
} from "@lervo/verification";

import { deliberationSha256 } from "./integrity.js";
import {
  DeliberationError,
  type DeliberationVerificationEvidence,
} from "./types.js";

export function verificationEvidenceById(
  evidence: readonly DeliberationVerificationEvidence[],
): Map<string, DeliberationVerificationEvidence> {
  const result = new Map<string, DeliberationVerificationEvidence>();
  for (const item of evidence) {
    if (result.has(item.result.verificationId)) {
      throw new DeliberationError(
        "verification_evidence_invalid",
        "같은 verification ID의 근거가 중복되었습니다.",
      );
    }
    try {
      validateVerificationResult(item.result, item.suite);
    } catch (error) {
      throw new DeliberationError(
        "verification_evidence_invalid",
        "숙의에 연결한 verification result가 suite 계약과 다릅니다.",
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
        "Verification result artifact 좌표가 canonical 결과와 다릅니다.",
      );
    }
    result.set(item.result.verificationId, item);
  }
  return result;
}
