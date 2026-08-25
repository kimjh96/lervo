import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  createGitHubReleaseTrustPolicy,
  createGitHubVerificationArguments,
  githubOidcIssuer,
  verifyGitHubAttestation,
} from "../lib/github-attestation-verifier.mjs";
import { slsaProvenanceType } from "../lib/cli-release-attestation.mjs";

const sourceDigest = "a".repeat(40);

describe("GitHub release attestation verifier adapter", () => {
  it("uses exact certificate, repository, tag ref and commit policies", () => {
    const policy = createGitHubReleaseTrustPolicy({
      repository: "lervo-dev/lervo",
      tag: "v0.1.0",
      sourceDigest,
    });
    const args = createGitHubVerificationArguments({
      artifactPath: "/release/lervo-cli-0.1.0.tgz",
      bundlePath: "/release/attestations/build-provenance.sigstore.json",
      predicateType: slsaProvenanceType,
      policy,
      trustedRootPath: "/trust/trusted_root.jsonl",
    });

    assert.deepEqual(args, [
      "attestation",
      "verify",
      "/release/lervo-cli-0.1.0.tgz",
      "--bundle",
      "/release/attestations/build-provenance.sigstore.json",
      "--repo",
      "lervo-dev/lervo",
      "--cert-identity",
      "https://github.com/lervo-dev/lervo/.github/workflows/cli-release-matrix.yml@refs/tags/v0.1.0",
      "--cert-oidc-issuer",
      githubOidcIssuer,
      "--source-ref",
      "refs/tags/v0.1.0",
      "--source-digest",
      sourceDigest,
      "--signer-digest",
      sourceDigest,
      "--deny-self-hosted-runners",
      "--predicate-type",
      slsaProvenanceType,
      "--custom-trusted-root",
      "/trust/trusted_root.jsonl",
      "--format",
      "json",
    ]);
    assert.equal(args.includes("--signer-workflow"), false);
  });

  it("rejects broad or incomplete trust policy coordinates", () => {
    for (const input of [
      { repository: "lervo-dev", tag: "v0.1.0", sourceDigest },
      { repository: "lervo-dev/lervo", tag: "main", sourceDigest },
      { repository: "lervo-dev/lervo", tag: "v0.1.0", sourceDigest: "a".repeat(39) },
    ]) {
      assert.throws(() => createGitHubReleaseTrustPolicy(input), {
        code: "release_attestation_trust_policy_invalid",
      });
    }
  });

  it("parses only successful JSON output and hides verifier failures", async () => {
    const policy = createGitHubReleaseTrustPolicy({
      repository: "lervo-dev/lervo",
      tag: "v0.1.0",
      sourceDigest,
    });
    const inputs = {
      artifactPath: "/release/lervo-cli-0.1.0.tgz",
      bundlePath: "/release/build.sigstore.json",
      predicateType: slsaProvenanceType,
      policy,
    };
    const output = [{ verificationResult: { statement: {} } }];
    assert.deepEqual(
      await verifyGitHubAttestation(inputs, async () => ({ stdout: JSON.stringify(output) })),
      output,
    );
    await assert.rejects(
      verifyGitHubAttestation(inputs, async () => {
        throw new Error("credential and temporary path");
      }),
      { code: "release_attestation_signature_unverified" },
    );
  });
});
