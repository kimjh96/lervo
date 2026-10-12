import {
  nativeAddonArtifactDigest,
  nativeAddonDigest,
  validateNativeAddonArtifact,
} from "./native-addon-contract.mjs";

export const nativeCasNames = ["cas-io-darwin.node", "cas-io.json"];
export const nativeCasDigest = nativeAddonDigest;
export const nativeCasArtifactDigest = (artifact) =>
  nativeAddonArtifactDigest(artifact, nativeCasNames);
export const validateNativeCasArtifact = (manifest, binary, expectedSourceHash) =>
  validateNativeAddonArtifact(manifest, binary, expectedSourceHash, "native_cas");
