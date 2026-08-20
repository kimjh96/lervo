import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { inTotoStatementType, localUnsignedBuilderId } from "./cli-release-attestation.mjs";
import { releaseSbomSerialNumber } from "./cli-release-sbom.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

export const cyclonedxPredicateType = "https://cyclonedx.org/bom";

const sha256Pattern = /^[a-f0-9]{64}$/u;

export class ReleaseAttestationVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseAttestationVerificationError";
    this.code = code;
  }
}

export function failReleaseVerification(code, message) {
  throw new ReleaseAttestationVerificationError(code, message);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function compareNames(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

export function createReleaseSubject(name, contents) {
  if (typeof name !== "string" || name.length === 0 || !Buffer.isBuffer(contents)) {
    failReleaseVerification(
      "release_attestation_verification_input_invalid",
      "Release attestation 검증 입력이 올바르지 않습니다.",
    );
  }
  return { name, digest: { sha256: sha256(contents) } };
}

export function sortReleaseSubjects(subjects) {
  return [...subjects].sort(compareNames);
}

function normalizedSubjects(subjects) {
  if (
    !Array.isArray(subjects) ||
    subjects.length === 0 ||
    subjects.some((subject) =>
      subject === null ||
      typeof subject !== "object" ||
      typeof subject.name !== "string" ||
      subject.name.length === 0 ||
      subject.digest === null ||
      typeof subject.digest !== "object" ||
      Object.keys(subject.digest).length !== 1 ||
      typeof subject.digest.sha256 !== "string" ||
      !sha256Pattern.test(subject.digest.sha256)
    )
  ) {
    failReleaseVerification(
      "release_attestation_verified_statement_invalid",
      "검증된 release statement 구조가 올바르지 않습니다.",
    );
  }
  const sorted = sortReleaseSubjects(subjects.map(({ name, digest }) => ({ name, digest })));
  if (sorted.some((subject, index) => index > 0 && sorted[index - 1].name === subject.name)) {
    failReleaseVerification(
      "release_attestation_verified_statement_invalid",
      "검증된 release statement subject가 중복됩니다.",
    );
  }
  return sorted;
}

export function validateVerifiedAttestationResults(results, expected) {
  if (!Array.isArray(results) || results.length !== 1) {
    failReleaseVerification(
      "release_attestation_verifier_output_invalid",
      "Attestation verifier 결과가 올바르지 않습니다.",
    );
  }
  const result = results[0];
  const verification = result?.verificationResult;
  const statement = verification?.statement;
  if (
    result?.attestation === null ||
    typeof result?.attestation !== "object" ||
    verification?.signature?.certificate === null ||
    typeof verification?.signature?.certificate !== "object" ||
    !Array.isArray(verification?.verifiedTimestamps) ||
    verification.verifiedTimestamps.length === 0 ||
    verification.verifiedTimestamps.some((timestamp) =>
      timestamp === null || typeof timestamp !== "object"
    ) ||
    statement === null ||
    typeof statement !== "object" ||
    statement._type !== inTotoStatementType ||
    statement.predicateType !== expected.predicateType
  ) {
    failReleaseVerification(
      "release_attestation_verifier_output_invalid",
      "Attestation verifier 결과가 올바르지 않습니다.",
    );
  }
  if (
    canonicalJson(normalizedSubjects(statement.subject)) !==
    canonicalJson(sortReleaseSubjects(expected.subjects))
  ) {
    failReleaseVerification(
      "release_attestation_verified_subject_mismatch",
      "검증된 release subject가 전달받은 파일과 다릅니다.",
    );
  }
  if (
    expected.predicate !== undefined &&
    !isDeepStrictEqual(statement.predicate, expected.predicate)
  ) {
    failReleaseVerification(
      "release_attestation_verified_predicate_mismatch",
      "검증된 release predicate가 전달받은 문서와 다릅니다.",
    );
  }
  return {
    predicateType: statement.predicateType,
    verifiedTimestampCount: verification.verifiedTimestamps.length,
  };
}

export function rejectLocalUnsignedStatement(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    value._type === inTotoStatementType &&
    value.predicate?.runDetails?.builder?.id === localUnsignedBuilderId
  ) {
    failReleaseVerification(
      "release_attestation_unsigned_untrusted",
      "로컬 unsigned statement는 release 신뢰 근거로 사용할 수 없습니다.",
    );
  }
}

export function validateDeliveredReleaseSbom(sbom, packageVersion) {
  if (sbom === null || typeof sbom !== "object" || Array.isArray(sbom)) {
    failReleaseVerification(
      "release_attestation_release_set_invalid",
      "Release attestation 파일 집합이 올바르지 않습니다.",
    );
  }
  const { serialNumber, ...withoutSerial } = sbom;
  if (
    sbom.$schema !== "https://cyclonedx.org/schema/bom-1.7.schema.json" ||
    sbom.bomFormat !== "CycloneDX" ||
    sbom.specVersion !== "1.7" ||
    sbom.version !== 1 ||
    serialNumber !== releaseSbomSerialNumber(withoutSerial) ||
    sbom.metadata?.component?.purl !== `pkg:npm/%40lervo/cli@${packageVersion}` ||
    !Array.isArray(sbom.components) ||
    !Array.isArray(sbom.dependencies)
  ) {
    failReleaseVerification(
      "release_attestation_release_set_invalid",
      "Release attestation 파일 집합이 올바르지 않습니다.",
    );
  }
  return sbom;
}
