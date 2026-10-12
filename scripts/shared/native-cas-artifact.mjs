import {
  nativeAddonSourceHash,
  readNativeAddonArtifact,
  copyNativeAddonArtifact,
} from "./native-addon-artifact.mjs";
import { nativeCasNames } from "./native-cas-contract.mjs";

const contract = {
  names: nativeCasNames,
  manifestName: "cas-io.json",
  binaryName: "cas-io-darwin.node",
  errorPrefix: "native_cas",
};
export const readNativeCasArtifact = (directory, options) =>
  readNativeAddonArtifact(directory, contract, options);
export const copyNativeCasArtifact = (source, output, options) =>
  copyNativeAddonArtifact(source, output, contract, options);

export function nativeCasSourceHash(repositoryRoot) {
  return nativeAddonSourceHash(repositoryRoot, [
    "packages/cas/native/binding.c",
    "packages/cas/native/cas-io.c",
    "packages/cas/native/cas-io.h",
    "packages/cas/scripts/build-native.mjs",
    "packages/cas/scripts/build-native-artifact.mjs",
    "scripts/shared/native-cas-contract.mjs",
    "scripts/shared/native-cas-artifact.mjs",
    "scripts/shared/native-addon-contract.mjs",
    "scripts/shared/native-addon-artifact.mjs",
    "scripts/shared/native-runtime-artifact.mjs",
    "scripts/shared/native-runtime-contract.mjs",
  ]);
}
