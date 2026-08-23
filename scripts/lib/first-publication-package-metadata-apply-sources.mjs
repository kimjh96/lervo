import {
  firstPublicationPackageMetadataSourcePaths,
  readFirstPublicationPackageMetadataSourceSet,
} from "./first-publication-package-metadata-source-set.mjs";

export const firstPublicationPackageMetadataApplySourcePaths =
  firstPublicationPackageMetadataSourcePaths;

export function readFirstPublicationPackageMetadataApplySources(paths, permitPath) {
  return readFirstPublicationPackageMetadataSourceSet(paths, permitPath, {
    evidenceId: "permit",
    errorCode: "first_publication_package_metadata_apply_source_invalid",
    errorMessage: "The CLI first-publication package metadata apply source is invalid.",
  });
}
