import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createCliReleaseManifest } from "./cli-release-snapshot.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { deployBuiltCli } from "./installed-cli.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_package_metadata_post_apply_release_inconsistent",
    "The CLI first-publication package metadata does not match the release sources.",
  );
}

export async function generateFirstPublicationPackageMetadataPostApplyRelease(
  { packageManifest, releaseManifest },
  dependencies = {},
) {
  const deploy = dependencies.deployBuiltCli ?? deployBuiltCli;
  const createManifest = dependencies.createReleaseManifest ?? createCliReleaseManifest;
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-metadata-verify-"));
  try {
    const deploymentRoot = resolve(fixtureRoot, "installation");
    await deploy(deploymentRoot);
    return await createManifest(
      deploymentRoot,
      releaseManifest?.dependencies?.platformSpecificFamilies,
      false,
      { cliManifest: packageManifest },
    );
  } catch {
    fail();
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}
