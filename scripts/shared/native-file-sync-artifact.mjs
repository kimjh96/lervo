import {
  nativeAddonSourceHash,
  readNativeAddonArtifact,
  copyNativeAddonArtifact,
} from "./native-addon-artifact.mjs";
import { nativeFileSyncNames } from "./native-file-sync-contract.mjs";

const contract = {
  names: nativeFileSyncNames,
  manifestName: "file-sync.json",
  binaryName: "file-sync-darwin.node",
  errorPrefix: "native_file_sync",
};
export const readNativeFileSyncArtifact = (directory, options) =>
  readNativeAddonArtifact(directory, contract, options);
export const copyNativeFileSyncArtifact = (source, output, options) =>
  copyNativeAddonArtifact(source, output, contract, options);

export async function nativeFileSyncSourceHash(repositoryRoot) {
  const paths = [
    "packages/filesystem-durability/native/binding.c",
    "packages/filesystem-durability/native/sync-group.c",
    "packages/filesystem-durability/native/sync-group.h",
    "packages/filesystem-durability/scripts/build-native.mjs",
    "scripts/shared/native-file-sync-contract.mjs",
    "scripts/shared/native-file-sync-artifact.mjs",
    "scripts/shared/native-addon-contract.mjs",
    "scripts/shared/native-addon-artifact.mjs",
    "scripts/shared/native-runtime-artifact.mjs",
  ];
  return nativeAddonSourceHash(repositoryRoot, paths);
}
