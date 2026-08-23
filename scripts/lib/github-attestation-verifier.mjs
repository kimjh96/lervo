import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

import {
  failReleaseVerification,
  ReleaseAttestationVerificationError,
} from "./release-attestation-consumer.mjs";

const execFileAsync = promisify(execFile);
const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/u;
const sourceDigestPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export const githubOidcIssuer = "https://token.actions.githubusercontent.com";
export const releaseWorkflowPath = ".github/workflows/cli-release-matrix.yml";

export function createGitHubReleaseTrustPolicy({ repository, tag, sourceDigest }) {
  const repositoryName = typeof repository === "string"
    ? repository.slice(repository.indexOf("/") + 1)
    : "";
  if (
    typeof repository !== "string" ||
    !repositoryPattern.test(repository) ||
    repository.includes("..") ||
    !/[A-Za-z0-9]/u.test(repositoryName) ||
    typeof tag !== "string" ||
    !/^v\d+\.\d+\.\d+$/u.test(tag) ||
    typeof sourceDigest !== "string" ||
    !sourceDigestPattern.test(sourceDigest)
  ) {
    failReleaseVerification(
      "release_attestation_trust_policy_invalid",
      "The release attestation trust policy is invalid.",
    );
  }
  const sourceRef = `refs/tags/${tag}`;
  return {
    repository,
    tag,
    sourceDigest,
    sourceRef,
    certificateIdentity:
      `https://github.com/${repository}/${releaseWorkflowPath}@${sourceRef}`,
  };
}

export function createGitHubVerificationArguments({
  artifactPath,
  bundlePath,
  predicateType,
  policy,
  trustedRootPath,
}) {
  if (
    !isAbsolute(artifactPath) ||
    !isAbsolute(bundlePath) ||
    typeof predicateType !== "string" ||
    predicateType.length === 0 ||
    (trustedRootPath !== undefined && !isAbsolute(trustedRootPath))
  ) {
    failReleaseVerification(
      "release_attestation_verification_input_invalid",
      "The release attestation verification input is invalid.",
    );
  }
  return [
    "attestation",
    "verify",
    artifactPath,
    "--bundle",
    bundlePath,
    "--repo",
    policy.repository,
    "--cert-identity",
    policy.certificateIdentity,
    "--cert-oidc-issuer",
    githubOidcIssuer,
    "--source-ref",
    policy.sourceRef,
    "--source-digest",
    policy.sourceDigest,
    "--signer-digest",
    policy.sourceDigest,
    "--deny-self-hosted-runners",
    "--predicate-type",
    predicateType,
    ...(trustedRootPath === undefined
      ? []
      : ["--custom-trusted-root", trustedRootPath]),
    "--format",
    "json",
  ];
}

export async function verifyGitHubAttestation(inputs, execute = execFileAsync) {
  const args = createGitHubVerificationArguments(inputs);
  let stdout;
  try {
    ({ stdout } = await execute("gh", args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        GH_PAGER: "cat",
        GH_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
      },
    }));
  } catch (error) {
    if (error instanceof ReleaseAttestationVerificationError) throw error;
    failReleaseVerification(
      "release_attestation_signature_unverified",
      "The release attestation signature and identity could not be verified.",
    );
  }
  try {
    return JSON.parse(stdout);
  } catch {
    failReleaseVerification(
      "release_attestation_verifier_output_invalid",
      "The attestation verifier result is invalid.",
    );
  }
}
