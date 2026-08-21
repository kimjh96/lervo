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
    errorMessage: "CLI 최초 게시 package metadata 사후 검증 원본이 올바르지 않습니다.",
  });
}
