import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  createReleaseSubject,
  cyclonedxPredicateType,
  rejectLocalUnsignedStatement,
  validateVerifiedAttestationResults,
} from "../lib/release-attestation-consumer.mjs";
import {
  inTotoStatementType,
  localUnsignedBuilderId,
  slsaProvenanceType,
} from "../lib/cli-release-attestation.mjs";

function verifiedResult(statement) {
  return [{
    attestation: { mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" },
    verificationResult: {
      signature: { certificate: { issuer: "https://token.actions.githubusercontent.com" } },
      verifiedTimestamps: [{ type: "transparency-log" }],
      statement,
    },
  }];
}

describe("release attestation consumer policy", () => {
  it("accepts one cryptographically verified statement with the exact subject set", () => {
    const subjects = [
      createReleaseSubject("lervo-cli-0.1.0.tgz", Buffer.from("tarball")),
      createReleaseSubject("release-artifact-manifest.json", Buffer.from("manifest")),
      createReleaseSubject("release-sbom.cdx.json", Buffer.from("sbom")),
    ];
    const result = validateVerifiedAttestationResults(verifiedResult({
      _type: inTotoStatementType,
      subject: [...subjects].reverse(),
      predicateType: slsaProvenanceType,
      predicate: {},
    }), { predicateType: slsaProvenanceType, subjects });

    assert.equal(result.predicateType, slsaProvenanceType);
    assert.equal(result.verifiedTimestampCount, 1);
  });

  it("rejects a verified statement that omits or changes a release subject", () => {
    const subjects = [createReleaseSubject("lervo-cli-0.1.0.tgz", Buffer.from("tarball"))];
    const changed = [createReleaseSubject("lervo-cli-0.1.0.tgz", Buffer.from("changed"))];

    assert.throws(
      () => validateVerifiedAttestationResults(verifiedResult({
        _type: inTotoStatementType,
        subject: changed,
        predicateType: slsaProvenanceType,
        predicate: {},
      }), { predicateType: slsaProvenanceType, subjects }),
      { code: "release_attestation_verified_subject_mismatch" },
    );
  });

  it("requires the signed CycloneDX predicate to equal the delivered SBOM", () => {
    const subjects = [createReleaseSubject("lervo-cli-0.1.0.tgz", Buffer.from("tarball"))];

    assert.throws(
      () => validateVerifiedAttestationResults(verifiedResult({
        _type: inTotoStatementType,
        subject: subjects,
        predicateType: cyclonedxPredicateType,
        predicate: { bomFormat: "CycloneDX", version: 2 },
      }), {
        predicateType: cyclonedxPredicateType,
        subjects,
        predicate: { bomFormat: "CycloneDX", version: 1 },
      }),
      { code: "release_attestation_verified_predicate_mismatch" },
    );
  });

  it("compares signed predicate objects without depending on key order", () => {
    const subjects = [createReleaseSubject("lervo-cli-0.1.0.tgz", Buffer.from("tarball"))];
    const result = validateVerifiedAttestationResults(verifiedResult({
      _type: inTotoStatementType,
      subject: subjects,
      predicateType: cyclonedxPredicateType,
      predicate: { version: 1, bomFormat: "CycloneDX" },
    }), {
      predicateType: cyclonedxPredicateType,
      subjects,
      predicate: { bomFormat: "CycloneDX", version: 1 },
    });

    assert.equal(result.predicateType, cyclonedxPredicateType);
  });

  it("rejects the local unsigned statement before treating it as a bundle", () => {
    assert.throws(
      () => rejectLocalUnsignedStatement({
        _type: inTotoStatementType,
        predicate: { runDetails: { builder: { id: localUnsignedBuilderId } } },
      }),
      { code: "release_attestation_unsigned_untrusted" },
    );
  });
});
