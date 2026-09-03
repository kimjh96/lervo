import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { repositoryRoot } from "../../../distribution/lib/installed-cli.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "../../lib/release-attestation-file-set.mjs";
import { sha256 } from "../../../shared/release-artifact-manifest.mjs";

const maximumSourceBytes = 1024 * 1024;

export const firstPublicationActivationSourcePaths = Object.freeze({
  packageManifestPath: resolve(repositoryRoot, "apps/cli/package.json"),
  releaseManifestPath: resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json"),
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_activation_blocker_source_invalid",
    "The CLI first-publication activation-blocker report source is invalid.",
  );
}

function parseJson(contents) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
}

export async function readFirstPublicationActivationSources({
  packageManifestPath,
  releaseManifestPath,
}) {
  if (!isAbsolute(packageManifestPath ?? "") || !isAbsolute(releaseManifestPath ?? "")) fail();
  const [packageContents, releaseContents] = await Promise.all([
    readRegularReleaseFile(packageManifestPath, maximumSourceBytes),
    readRegularReleaseFile(releaseManifestPath, maximumSourceBytes),
  ]);
  const packageManifest = parseJson(packageContents);
  return {
    packageManifest,
    releaseManifest: parseJson(releaseContents),
    sourceSnapshots: {
      packageManifest: {
        contents: packageContents,
        byteCount: packageContents.length,
        sha256: sha256(packageContents),
      },
      releaseManifest: {
        contents: releaseContents,
        byteCount: releaseContents.length,
        sha256: sha256(releaseContents),
      },
    },
    assertUnchanged: () =>
      assertReleaseFilesUnchanged([
        {
          path: packageManifestPath,
          contents: packageContents,
          maximumSize: maximumSourceBytes,
        },
        {
          path: releaseManifestPath,
          contents: releaseContents,
          maximumSize: maximumSourceBytes,
        },
      ]),
  };
}
