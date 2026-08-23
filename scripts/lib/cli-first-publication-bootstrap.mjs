import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  createFirstPublicationBootstrapAuthorization,
  validateFirstPublicationBootstrapLocalInputs,
} from "./first-publication-bootstrap-authorization.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationExternalEvidenceReportDocument } from
  "./first-publication-external-evidence-reader.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { repositoryRoot } from "./installed-cli.mjs";
import { observeNpmPublicPackage } from "./npm-public-package-observer.mjs";
import {
  createReleasePublicationArtifact,
  validateReleasePublicationAuthorization,
} from "./release-publication-authorization.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes,
} from "./release-attestation-file-set.mjs";
import { canonicalJson, validateReleaseArtifactManifest } from "./release-artifact-manifest.mjs";

const packageManifestPath = resolve(repositoryRoot, "apps/cli/package.json");
const inputMaximumSize = 64 * 1024;

function fail(code = "first_publication_bootstrap_input_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication bootstrap input is invalid.",
  );
}

function parseJson(contents) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    fail();
  }
}

async function readCliFirstPublicationBootstrapSources(options) {
  const paths = {
    packageManifest: packageManifestPath,
    releaseManifest: resolve(options.releaseDirectory, "release-artifact-manifest.json"),
    publicationAuthorization: options.publicationAuthorizationPath,
    externalEvidence: options.externalEvidencePath,
  };
  const snapshots = await Promise.all([
    readRegularReleaseFile(paths.packageManifest, inputMaximumSize),
    readRegularReleaseFile(
      paths.releaseManifest,
      releaseVerificationMaximumSizes.document,
    ),
    readRegularReleaseFile(paths.publicationAuthorization, inputMaximumSize),
    readRegularReleaseFile(paths.externalEvidence, inputMaximumSize),
  ]);
  const [packageContents, releaseManifestContents, authorizationContents, evidenceContents] =
    snapshots;
  const packageManifest = parseJson(packageContents);
  const releaseManifest = validateReleaseArtifactManifest(parseJson(releaseManifestContents));
  const publicationAuthorization = validateReleasePublicationAuthorization(
    parseJson(authorizationContents),
  );
  const externalEvidenceReport = validateFirstPublicationExternalEvidenceReportDocument(
    parseJson(evidenceContents),
  );
  const tarballPath = resolve(
    options.releaseDirectory,
    publicationAuthorization.artifact.file,
  );
  const tarballContents = await readRegularReleaseFile(
    tarballPath,
    releaseVerificationMaximumSizes.tarball,
  );
  const actualArtifact = createReleasePublicationArtifact(
    publicationAuthorization.artifact.file,
    publicationAuthorization.target.version,
    tarballContents,
  );
  const manifestSubject = publicationAuthorization.release.subjects.find(
    ({ name }) => name === "release-artifact-manifest.json",
  );
  if (canonicalJson(actualArtifact) !== canonicalJson(publicationAuthorization.artifact)) {
    fail("first_publication_release_changed");
  }
  if (
    manifestSubject?.digest?.sha256 !==
      createHash("sha256").update(releaseManifestContents).digest("hex")
  ) fail("first_publication_release_changed");
  return {
    packageManifest,
    releaseManifest,
    publicationAuthorization,
    externalEvidenceReport,
    assertUnchanged: () => assertReleaseFilesUnchanged([
      { path: paths.packageManifest, contents: packageContents, maximumSize: inputMaximumSize },
      {
        path: paths.releaseManifest,
        contents: releaseManifestContents,
        maximumSize: releaseVerificationMaximumSizes.document,
      },
      {
        path: paths.publicationAuthorization,
        contents: authorizationContents,
        maximumSize: inputMaximumSize,
      },
      {
        path: paths.externalEvidence,
        contents: evidenceContents,
        maximumSize: inputMaximumSize,
      },
      {
        path: tarballPath,
        contents: tarballContents,
        maximumSize: releaseVerificationMaximumSizes.tarball,
      },
    ]),
  };
}

export async function authorizeCliFirstPublicationBootstrap(options, dependencies = {}) {
  if (
    options?.online !== true ||
    !isAbsolute(options.releaseDirectory ?? "") ||
    !isAbsolute(options.publicationAuthorizationPath ?? "") ||
    !isAbsolute(options.externalEvidencePath ?? "")
  ) fail(options?.online === true ? undefined : "first_publication_online_required");
  const readSources = dependencies.readSources ?? readCliFirstPublicationBootstrapSources;
  const observePackage = dependencies.observeNpmPublicPackage ?? observeNpmPublicPackage;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const sources = await readSources(options);
  validateFirstPublicationBootstrapLocalInputs({
    ...sources,
    checkedAt: now(),
  });
  const packageObservation = await observePackage();
  const observedAt = now();
  const bootstrap = createFirstPublicationBootstrapAuthorization({
    ...sources,
    packageObservation,
    observedAt,
  });
  await sources.assertUnchanged();
  return bootstrap;
}

export async function writeFirstPublicationBootstrapAuthorization(outputPath, bootstrap) {
  if (!isAbsolute(outputPath)) fail();
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  await writeFile(outputPath, `${JSON.stringify(bootstrap, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
