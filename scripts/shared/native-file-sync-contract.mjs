import {
  nativeAddonArtifactDigest,
  nativeAddonDigest,
  validateNativeAddonArtifact,
} from "./native-addon-contract.mjs";

export const nativeFileSyncNames = ["file-sync-darwin.node", "file-sync.json"];
export const nativeFileSyncDigest = nativeAddonDigest;
export const nativeFileSyncArtifactDigest = (artifact) =>
  nativeAddonArtifactDigest(artifact, nativeFileSyncNames);
export const validateNativeFileSyncArtifact = (manifest, binary, expectedSourceHash) =>
  validateNativeAddonArtifact(manifest, binary, expectedSourceHash, "native_file_sync");

export function nativeFileSyncSbomComponents(artifact) {
  if (artifact === undefined) return [];
  return nativeFileSyncNames.map((name) => ({
    type: "file",
    "bom-ref": `lervo:native-file-sync:${name}`,
    name: `dist/native/${name}`,
    hashes: [{ alg: "SHA-256", content: nativeFileSyncDigest(artifact.files[name]).slice(7) }],
  }));
}

export function nativeFileSyncInventoryValid(files, required) {
  const entries = files.filter((entry) => entry.path?.startsWith("dist/native/"));
  if (!entries.length) return !required;
  return (
    entries.length === 2 &&
    nativeFileSyncNames.every((name) => {
      const entry = entries.find((file) => file.path === `dist/native/${name}`);
      return (
        entry?.kind === "file" &&
        entry.size > 0 &&
        entry.size <= (name.endsWith(".node") ? 1048576 : 4096)
      );
    })
  );
}

export function validateNativeFileSyncSbom(sbom, artifact) {
  const expected = nativeFileSyncSbomComponents(artifact);
  const actual = (sbom?.components ?? []).filter((component) =>
    component["bom-ref"]?.startsWith("lervo:native-file-sync:"),
  );
  const root = sbom?.dependencies?.find(
    (entry) => entry.ref === sbom?.metadata?.component?.["bom-ref"],
  );
  if (
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    expected.some((component) => {
      const ref = component["bom-ref"];
      const nodes = sbom.dependencies.filter((entry) => entry.ref === ref);
      return (
        root?.dependsOn?.filter((value) => value === ref).length !== 1 ||
        nodes.length !== 1 ||
        nodes[0].dependsOn?.length !== 0
      );
    })
  )
    throw new Error("native_file_sync_sbom_invalid");
}
