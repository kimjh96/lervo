import { ReleaseAttestationVerificationError } from "./lib/release-attestation-consumer.mjs";
import { verifyCliReleaseAttestations } from "./lib/cli-release-attestation-consumer.mjs";
import { ReleaseAttestationError } from "./lib/cli-release-attestation.mjs";
import { ReleaseArtifactManifestError } from "./lib/release-artifact-manifest.mjs";

function failArguments() {
  throw new ReleaseAttestationVerificationError(
    "release_attestation_verification_arguments_invalid",
    "The release attestation verification command arguments are invalid.",
  );
}

function parseArguments(args) {
  const values = new Map();
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--json") {
      if (json) failArguments();
      json = true;
      continue;
    }
    if (
      ![
        "--release-directory",
        "--repository",
        "--tag",
        "--source-digest",
        "--trusted-root",
      ].includes(name) ||
      values.has(name) ||
      index + 1 >= args.length
    ) {
      failArguments();
    }
    values.set(name, args[index + 1]);
    index += 1;
  }
  for (const name of ["--release-directory", "--repository", "--tag", "--source-digest"]) {
    if (!values.has(name)) failArguments();
  }
  return {
    releaseDirectory: values.get("--release-directory"),
    repository: values.get("--repository"),
    tag: values.get("--tag"),
    sourceDigest: values.get("--source-digest"),
    trustedRootPath: values.get("--trusted-root"),
    json,
  };
}

try {
  const { json, ...options } = parseArguments(process.argv.slice(2));
  const report = await verifyCliReleaseAttestations(options);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log("CLI release attestation consumer check passed (2 bundles, 3 subjects)");
  }
} catch (error) {
  if (
    error instanceof ReleaseAttestationVerificationError ||
    error instanceof ReleaseAttestationError ||
    error instanceof ReleaseArtifactManifestError
  ) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(
      "release_attestation_verification_failed: Release attestation verification could not be completed.",
    );
  }
  process.exitCode = 1;
}
