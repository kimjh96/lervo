import { canonicalJson } from "./release-artifact-manifest.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";

function state(current, expected, missing) {
  if (canonicalJson(current) === canonicalJson(expected)) return "matching";
  return missing ? "missing" : "different";
}

function packageChanges(packageManifest, decision) {
  const repository = {
    type: "git",
    url: `git+https://github.com/${decision.target.repository}.git`,
  };
  const candidates = [
    {
      field: "repository",
      current: packageManifest.repository,
      value: repository,
      missing: packageManifest.repository === undefined,
    },
    {
      field: "license",
      current: packageManifest.license,
      value: decision.target.license,
      missing: packageManifest.license === undefined || packageManifest.license === "UNLICENSED",
    },
    {
      field: "publishConfig.registry",
      current: packageManifest.publishConfig?.registry,
      value: npmPublicRegistry,
      missing: packageManifest.publishConfig?.registry === undefined,
    },
    {
      field: "publishConfig.provenance",
      current: packageManifest.publishConfig?.provenance,
      value: true,
      missing: packageManifest.publishConfig?.provenance === undefined,
    },
  ];
  return candidates.flatMap(({ field, current, value, missing }) => {
    const currentState = state(current, value, missing);
    return currentState === "matching"
      ? []
      : [{ source: "package_manifest", operation: "set", field, currentState, value }];
  });
}

function releaseManifestRegeneration(releaseManifest, decision, hasPackageChanges) {
  const expected = {
    repository: `git+https://github.com/${decision.target.repository}.git`,
    license: decision.target.license,
    registry: npmPublicRegistry,
    provenance: true,
  };
  const releaseMatches = Object.entries(expected).every(
    ([field, value]) => canonicalJson(releaseManifest.artifact[field]) === canonicalJson(value),
  );
  return {
    status: hasPackageChanges || !releaseMatches ? "required" : "not_required",
    action: "regenerate_after_package_metadata_update",
    directPatch: "forbidden",
    expectedArtifactMetadata: expected,
  };
}

export function inspectFirstPublicationMetadataPatch({
  packageManifest,
  releaseManifest,
  decision,
}) {
  const changes = packageChanges(packageManifest, decision);
  return {
    packageManifestChanges: changes,
    releaseManifestRegeneration: releaseManifestRegeneration(
      releaseManifest,
      decision,
      changes.length > 0,
    ),
  };
}
