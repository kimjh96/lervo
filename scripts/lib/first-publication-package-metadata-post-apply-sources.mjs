import {
  firstPublicationPackageMetadataSourcePaths,
  readFirstPublicationPackageMetadataSourceSet,
} from "./first-publication-package-metadata-source-set.mjs";

export const firstPublicationPackageMetadataPostApplySourcePaths =
  firstPublicationPackageMetadataSourcePaths;

export function readFirstPublicationPackageMetadataPostApplySources(paths, receiptPath) {
  return readFirstPublicationPackageMetadataSourceSet(paths, receiptPath, {
    evidenceId: "receipt",
    errorCode: "first_publication_package_metadata_post_apply_source_invalid",
    errorMessage: "The CLI first-publication package metadata post-apply verification source is invalid.",
  });
}
