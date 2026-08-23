import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalJson, sha256 } from "./release-artifact-manifest.mjs";

const allowedFields = [
  "description",
  "repository",
  "license",
  "publishConfig.registry",
  "publishConfig.provenance",
];

function fail(code = "first_publication_package_metadata_candidate_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication package metadata candidate is invalid.",
  );
}

function withoutAllowedFields(value) {
  const copy = structuredClone(value);
  delete copy.description;
  delete copy.repository;
  delete copy.license;
  if (copy.publishConfig !== null && typeof copy.publishConfig === "object") {
    delete copy.publishConfig.registry;
    delete copy.publishConfig.provenance;
  }
  return copy;
}

function applyChange(output, change) {
  if (
    change?.source !== "package_manifest" || change.operation !== "set" ||
    !allowedFields.includes(change.field)
  ) fail();
  if (change.field === "description" || change.field === "repository" || change.field === "license") {
    output[change.field] = structuredClone(change.value);
    return;
  }
  if (output.publishConfig === null || typeof output.publishConfig !== "object") fail();
  output.publishConfig[change.field.slice("publishConfig.".length)] = change.value;
}

export function createFirstPublicationPackageMetadataOutput({
  packageManifest,
  packageSourceContents,
  preview,
}) {
  if (!Buffer.isBuffer(packageSourceContents)) fail();
  const expectedSource = Buffer.from(`${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  if (!packageSourceContents.equals(expectedSource)) {
    fail("first_publication_package_metadata_source_format_unsupported");
  }
  if (preview.packageManifestChanges.length === 0) {
    fail("first_publication_package_metadata_patch_no_changes");
  }
  const outputManifest = structuredClone(packageManifest);
  for (const change of preview.packageManifestChanges) applyChange(outputManifest, change);
  if (
    canonicalJson(withoutAllowedFields(outputManifest)) !==
      canonicalJson(withoutAllowedFields(packageManifest))
  ) fail();
  const outputBytes = Buffer.from(`${JSON.stringify(outputManifest, null, 2)}\n`, "utf8");
  return {
    outputBytes,
    output: {
      encoding: "utf8",
      format: "json_pretty_2_lf",
      byteCount: outputBytes.length,
      sha256: sha256(outputBytes),
    },
    verification: {
      outputJsonValid: true,
      onlyAllowedFieldsChanged: true,
      previewApplied: true,
    },
  };
}
