import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parse } from "yaml";

import { createCliReleaseSbom, validateCliReleaseSbom } from "./cli-release-sbom.mjs";
import { createCliReleaseManifest } from "./cli-release-snapshot.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { deployBuiltCli } from "./installed-cli.mjs";
import {
  canonicalJson,
  releaseArtifactDigest,
  validateReleaseArtifactManifest,
} from "./release-artifact-manifest.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_package_metadata_release_regeneration_invalid",
    "The CLI first-publication package metadata generation sources could not be reproduced consistently.",
  );
}

function parseCandidateManifest(candidateResult) {
  try {
    return JSON.parse(candidateResult.outputBytes.toString("utf8"));
  } catch {
    fail();
  }
}

function expectedReleaseManifest(current, packageManifest) {
  const expected = structuredClone(current);
  expected.artifact.description = packageManifest.description;
  expected.artifact.repository = packageManifest.repository.url;
  expected.artifact.license = packageManifest.license;
  expected.artifact.registry = packageManifest.publishConfig.registry;
  expected.artifact.provenance = packageManifest.publishConfig.provenance;
  expected.artifactDigest = releaseArtifactDigest(expected);
  return expected;
}

export function createFirstPublicationPackageMetadataDerivedRelease({
  currentReleaseManifest,
  currentReleaseSbom,
  lockfile,
  candidateResult,
  generatedReleaseManifest,
}) {
  try {
    validateReleaseArtifactManifest(currentReleaseManifest);
    validateCliReleaseSbom(currentReleaseSbom, currentReleaseManifest, lockfile);
    validateReleaseArtifactManifest(generatedReleaseManifest);
  } catch {
    fail();
  }
  const packageManifest = parseCandidateManifest(candidateResult);
  const expected = expectedReleaseManifest(currentReleaseManifest, packageManifest);
  if (canonicalJson(generatedReleaseManifest) !== canonicalJson(expected)) fail();
  let releaseSbom;
  try {
    releaseSbom = validateCliReleaseSbom(
      createCliReleaseSbom(generatedReleaseManifest, lockfile),
      generatedReleaseManifest,
      lockfile,
    );
  } catch {
    fail();
  }
  return {
    packageManifest,
    releaseManifest: generatedReleaseManifest,
    releaseSbom,
    outputBytes: {
      packageManifest: Buffer.from(`${JSON.stringify(packageManifest, null, 2)}\n`),
      releaseManifest: Buffer.from(`${JSON.stringify(generatedReleaseManifest, null, 2)}\n`),
      releaseSbom: Buffer.from(`${JSON.stringify(releaseSbom, null, 2)}\n`),
    },
  };
}

export async function generateFirstPublicationPackageMetadataDerivedRelease(
  input,
  dependencies = {},
) {
  const deploy = dependencies.deployBuiltCli ?? deployBuiltCli;
  const createManifest = dependencies.createReleaseManifest ?? createCliReleaseManifest;
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-metadata-apply-"));
  try {
    const deploymentRoot = resolve(fixtureRoot, "installation");
    await deploy(deploymentRoot);
    const packageManifest = parseCandidateManifest(input.candidateResult);
    const generatedReleaseManifest = await createManifest(
      deploymentRoot,
      input.currentReleaseManifest.dependencies.platformSpecificFamilies,
      false,
      { cliManifest: packageManifest },
    );
    return createFirstPublicationPackageMetadataDerivedRelease({
      ...input,
      generatedReleaseManifest,
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

export function parseFirstPublicationPackageMetadataLockfile(contents) {
  try {
    return parse(contents.toString("utf8"));
  } catch {
    fail();
  }
}
