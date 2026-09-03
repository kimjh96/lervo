import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  firstPublicationActivationSourcePaths,
  readFirstPublicationActivationSources,
} from "../shared/first-publication-activation-sources.mjs";
import { repositoryRoot } from "../../../distribution/lib/installed-cli.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes,
} from "../../lib/release-attestation-file-set.mjs";
import { sha256 } from "../../../shared/release-artifact-manifest.mjs";

const evidenceMaximumBytes = 64 * 1024;

export const firstPublicationPackageMetadataSourcePaths = Object.freeze({
  ...firstPublicationActivationSourcePaths,
  releaseSbomPath: resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json"),
  lockfilePath: resolve(repositoryRoot, "pnpm-lock.yaml"),
});

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function parseJson(contents, failure) {
  try {
    const parsed = JSON.parse(contents.toString("utf8"));
    if (!contents.equals(Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`))) failure();
    return parsed;
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    failure();
  }
}

export async function readFirstPublicationPackageMetadataSourceSet(
  paths,
  evidencePath,
  { evidenceId, errorCode, errorMessage },
) {
  const failure = () => fail(errorCode, errorMessage);
  if (
    !isAbsolute(paths?.releaseSbomPath ?? "") ||
    !isAbsolute(paths?.lockfilePath ?? "") ||
    !isAbsolute(evidencePath ?? "") ||
    !["permit", "receipt"].includes(evidenceId)
  )
    failure();
  let activationSources;
  let sbomContents;
  let lockfileContents;
  let evidenceContents;
  try {
    activationSources = await readFirstPublicationActivationSources(paths);
    [sbomContents, lockfileContents, evidenceContents] = await Promise.all([
      readRegularReleaseFile(paths.releaseSbomPath, releaseVerificationMaximumSizes.document),
      readRegularReleaseFile(paths.lockfilePath, releaseVerificationMaximumSizes.document),
      readRegularReleaseFile(evidencePath, evidenceMaximumBytes),
    ]);
  } catch {
    failure();
  }
  return {
    ...activationSources,
    releaseSbom: parseJson(sbomContents, failure),
    [evidenceId]: parseJson(evidenceContents, failure),
    sourceSnapshots: {
      ...activationSources.sourceSnapshots,
      releaseSbom: snapshot(sbomContents),
      lockfile: snapshot(lockfileContents),
      [evidenceId]: snapshot(evidenceContents),
    },
    assertUnchanged: async () => {
      await activationSources.assertUnchanged();
      await assertReleaseFilesUnchanged([
        releaseFile(paths.releaseSbomPath, sbomContents),
        releaseFile(paths.lockfilePath, lockfileContents),
        releaseFile(evidencePath, evidenceContents, evidenceMaximumBytes),
      ]);
    },
  };
}

function snapshot(contents) {
  return { contents, byteCount: contents.length, sha256: sha256(contents) };
}

function releaseFile(path, contents, maximumSize = releaseVerificationMaximumSizes.document) {
  return { path, contents, maximumSize };
}
