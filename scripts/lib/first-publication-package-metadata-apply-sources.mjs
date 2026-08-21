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
    errorMessage: "CLI 최초 게시 package metadata 적용 원본이 올바르지 않습니다.",
  });
}
