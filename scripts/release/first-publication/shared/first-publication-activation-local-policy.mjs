import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { npmPublicRegistry } from "../../lib/release-publication-authorization.mjs";
import { validateReadinessRepository } from "../../lib/trusted-publisher-readiness.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_activation_blocker_report_invalid",
    "The CLI first-publication activation-blocker report is invalid.",
  );
}

function check(id, reasons) {
  return { id, status: reasons.length === 0 ? "ready" : "blocked", reasons };
}

function repositoryUrl(value, missing) {
  if (missing) return { state: "missing", coordinate: null };
  const match =
    typeof value === "string" ? /^git\+https:\/\/github\.com\/(.+)\.git$/u.exec(value) : null;
  if (match === null) return { state: "invalid", coordinate: null };
  try {
    return { state: "resolved", coordinate: validateReadinessRepository(match[1]) };
  } catch {
    return { state: "invalid", coordinate: null };
  }
}

function packageRepository(manifest) {
  const missing = manifest?.repository === undefined;
  const value = manifest?.repository?.type === "git" ? manifest.repository.url : null;
  return repositoryUrl(value, missing);
}

function releaseRepository(manifest) {
  const value = manifest?.artifact?.repository;
  return repositoryUrl(value, value === null);
}

function repositoryCheck(packageSource, releaseSource) {
  const reasons = [];
  if (packageSource.state !== "resolved") {
    reasons.push(`package_repository_${packageSource.state}`);
  }
  if (releaseSource.state !== "resolved") {
    reasons.push(`release_repository_${releaseSource.state}`);
  }
  if (
    packageSource.coordinate !== null &&
    releaseSource.coordinate !== null &&
    packageSource.coordinate !== releaseSource.coordinate
  )
    reasons.push("repository_mismatch");
  return check("repository_metadata", reasons);
}

function resolvedLicense(value) {
  return typeof value === "string" && value.length > 0 && value !== "UNLICENSED";
}

export function inspectFirstPublicationActivationLocalMetadata({
  packageManifest,
  releaseManifest,
}) {
  if (
    packageManifest === null ||
    typeof packageManifest !== "object" ||
    Array.isArray(packageManifest) ||
    releaseManifest?.artifact === null ||
    typeof releaseManifest?.artifact !== "object"
  )
    fail();
  const releaseArtifact = releaseManifest.artifact;
  const packageSource = packageRepository(packageManifest);
  const releaseSource = releaseRepository(releaseManifest);
  const identityReasons = [];
  if (packageManifest.name !== "@lervo/cli") identityReasons.push("package_name_mismatch");
  if (packageManifest.version !== releaseArtifact.version) {
    identityReasons.push("package_version_mismatch");
  }
  if (packageManifest.private !== false) identityReasons.push("package_not_public");
  if (packageManifest.publishConfig?.access !== "public") {
    identityReasons.push("package_access_not_public");
  }
  const licenseReasons = [];
  if (!resolvedLicense(packageManifest.license)) licenseReasons.push("package_license_unresolved");
  if (!resolvedLicense(releaseArtifact.license)) licenseReasons.push("release_license_unresolved");
  if (
    resolvedLicense(packageManifest.license) &&
    resolvedLicense(releaseArtifact.license) &&
    packageManifest.license !== releaseArtifact.license
  )
    licenseReasons.push("license_mismatch");
  const publicationReasons = [];
  if (packageManifest.publishConfig?.registry !== npmPublicRegistry) {
    publicationReasons.push("package_registry_unpinned");
  }
  if (releaseArtifact.registry !== npmPublicRegistry) {
    publicationReasons.push("release_registry_unpinned");
  }
  if (packageManifest.publishConfig?.provenance !== true) {
    publicationReasons.push("package_provenance_unpinned");
  }
  if (releaseArtifact.provenance !== true) {
    publicationReasons.push("release_provenance_unpinned");
  }
  const localChecks = [
    check("package_identity", identityReasons),
    repositoryCheck(packageSource, releaseSource),
    check("license_metadata", licenseReasons),
    check("publication_metadata", publicationReasons),
  ];
  return {
    target: {
      package: "@lervo/cli",
      version: releaseArtifact.version,
      repository:
        packageSource.coordinate !== null && packageSource.coordinate === releaseSource.coordinate
          ? packageSource.coordinate
          : null,
      license:
        resolvedLicense(packageManifest.license) &&
        packageManifest.license === releaseArtifact.license
          ? packageManifest.license
          : null,
      registry: npmPublicRegistry,
    },
    localStatus: localChecks.every(({ status }) => status === "ready") ? "ready" : "blocked",
    localChecks,
  };
}
