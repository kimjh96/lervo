import { createHash } from "node:crypto";

export const nativeFileSyncNames = ["file-sync-darwin.node", "file-sync.json"];
export const nativeFileSyncDigest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

/** Distribution validation is stricter than optional runtime capability discovery. */
export function validateNativeFileSyncArtifact(manifest, binary, expectedSourceHash) {
  if (
    !manifest ||
    Object.keys(manifest).sort().join(",") !==
      "apiVersion,architectures,contentHash,napiVersion,platform,schemaVersion,sourceHash" ||
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== 1 ||
    manifest.napiVersion !== 8 ||
    manifest.platform !== "darwin" ||
    JSON.stringify(manifest.architectures) !== '["arm64","x64"]' ||
    !digestPattern.test(manifest.sourceHash) ||
    (expectedSourceHash !== undefined && manifest.sourceHash !== expectedSourceHash) ||
    manifest.contentHash !== nativeFileSyncDigest(binary)
  )
    throw new Error("native_file_sync_identity_invalid");
  // Inspect the actual universal Mach-O slices rather than trusting architecture labels.
  if (
    binary.length < 48 ||
    binary.length > 1048576 ||
    binary.readUInt32BE(0) !== 0xcafebabe ||
    binary.readUInt32BE(4) !== 2
  )
    throw new Error("native_file_sync_binary_invalid");
  const slices = [];
  for (let index = 0; index < 2; index++) {
    const header = 8 + index * 20;
    const cpu = binary.readUInt32BE(header);
    const offset = binary.readUInt32BE(header + 8);
    const size = binary.readUInt32BE(header + 12);
    if (
      ![0x01000007, 0x0100000c].includes(cpu) ||
      slices.some((slice) => slice.cpu === cpu) ||
      offset < 48 ||
      size < 32 ||
      offset + size > binary.length ||
      slices.some((slice) => offset < slice.offset + slice.size && offset + size > slice.offset) ||
      binary.readUInt32LE(offset) !== 0xfeedfacf ||
      binary.readUInt32LE(offset + 4) !== cpu ||
      binary.readUInt32LE(offset + 12) !== 8
    )
      throw new Error("native_file_sync_binary_invalid");
    slices.push({ cpu, offset, size });
  }
  return manifest;
}

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
