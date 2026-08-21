import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  firstPublicationActivationSourcePaths,
  readFirstPublicationActivationSources,
} from "./first-publication-activation-sources.mjs";
import { repositoryRoot } from "./installed-cli.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes,
} from "./release-attestation-file-set.mjs";
import { sha256 } from "./release-artifact-manifest.mjs";

const permitMaximumBytes = 64 * 1024;

export const firstPublicationPackageMetadataApplySourcePaths = Object.freeze({
  ...firstPublicationActivationSourcePaths,
  releaseSbomPath: resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json"),
  lockfilePath: resolve(repositoryRoot, "pnpm-lock.yaml"),
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_package_metadata_apply_source_invalid",
    "CLI 최초 게시 package metadata 적용 원본이 올바르지 않습니다.",
  );
}

function parseJson(contents) {
  try {
    const parsed = JSON.parse(contents.toString("utf8"));
    if (!contents.equals(Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`))) fail();
    return parsed;
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
}

export async function readFirstPublicationPackageMetadataApplySources(paths, permitPath) {
  if (
    !isAbsolute(paths?.releaseSbomPath ?? "") ||
    !isAbsolute(paths?.lockfilePath ?? "") ||
    !isAbsolute(permitPath ?? "")
  ) fail();
  const activationSources = await readFirstPublicationActivationSources(paths);
  const [sbomContents, lockfileContents, permitContents] = await Promise.all([
    readRegularReleaseFile(
      paths.releaseSbomPath,
      releaseVerificationMaximumSizes.document,
    ),
    readRegularReleaseFile(
      paths.lockfilePath,
      releaseVerificationMaximumSizes.document,
    ),
    readRegularReleaseFile(permitPath, permitMaximumBytes),
  ]);
  return {
    ...activationSources,
    releaseSbom: parseJson(sbomContents),
    permit: parseJson(permitContents),
    sourceSnapshots: {
      ...activationSources.sourceSnapshots,
      releaseSbom: {
        contents: sbomContents,
        byteCount: sbomContents.length,
        sha256: sha256(sbomContents),
      },
      lockfile: {
        contents: lockfileContents,
        byteCount: lockfileContents.length,
        sha256: sha256(lockfileContents),
      },
      permit: {
        contents: permitContents,
        byteCount: permitContents.length,
        sha256: sha256(permitContents),
      },
    },
    assertUnchanged: async () => {
      await activationSources.assertUnchanged();
      await assertReleaseFilesUnchanged([
        {
          path: paths.releaseSbomPath,
          contents: sbomContents,
          maximumSize: releaseVerificationMaximumSizes.document,
        },
        {
          path: paths.lockfilePath,
          contents: lockfileContents,
          maximumSize: releaseVerificationMaximumSizes.document,
        },
        { path: permitPath, contents: permitContents, maximumSize: permitMaximumBytes },
      ]);
    },
  };
}
