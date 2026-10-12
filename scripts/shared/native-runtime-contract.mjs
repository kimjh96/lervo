import { nativeAddonDigest } from "./native-addon-contract.mjs";
import { nativeCasNames } from "./native-cas-contract.mjs";
import { nativeFileSyncNames, nativeFileSyncSbomComponents } from "./native-file-sync-contract.mjs";

export const nativeRuntimeNames = [...nativeFileSyncNames, ...nativeCasNames].sort();

export function nativeRuntimeInventoryValid(files, required) {
  const entries = files.filter((entry) => entry.path?.startsWith("dist/native/"));
  if (!entries.length) return !required;
  return (
    entries.length === nativeRuntimeNames.length &&
    nativeRuntimeNames.every((name) => {
      const entry = entries.find((file) => file.path === `dist/native/${name}`);
      return (
        entry?.kind === "file" &&
        entry.size > 0 &&
        entry.size <= (name.endsWith(".node") ? 1048576 : 4096)
      );
    })
  );
}

export function nativeRuntimeSbomComponents(artifact) {
  if (!artifact) return [];
  return [
    ...nativeFileSyncSbomComponents(artifact.sync),
    ...(artifact.cas
      ? nativeCasNames.map((name) => ({
          type: "file",
          "bom-ref": `lervo:native-cas:${name}`,
          name: `dist/native/${name}`,
          hashes: [{ alg: "SHA-256", content: nativeAddonDigest(artifact.files[name]).slice(7) }],
        }))
      : []),
  ];
}

export function validateNativeRuntimeSbom(sbom, artifact) {
  const expected = nativeRuntimeSbomComponents(artifact);
  const actual = (sbom?.components ?? []).filter((component) =>
    /^(?:lervo:native-file-sync:|lervo:native-cas:)/u.test(component["bom-ref"]),
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
    throw new Error("native_runtime_sbom_invalid");
}
