import { createHash } from "node:crypto";

export const nativeAddonDigest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const nativeAddonArtifactDigest = (artifact, names) =>
  nativeAddonDigest(
    JSON.stringify(names.map((name) => [name, nativeAddonDigest(artifact.files[name])])),
  );

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

/** Distribution validation is stricter than optional runtime capability discovery. */
export function validateNativeAddonArtifact(manifest, binary, expectedSourceHash, errorPrefix) {
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
    manifest.contentHash !== nativeAddonDigest(binary)
  )
    throw new Error(`${errorPrefix}_identity_invalid`);
  // Inspect the actual universal Mach-O slices rather than trusting architecture labels.
  if (
    binary.length < 48 ||
    binary.length > 1048576 ||
    binary.readUInt32BE(0) !== 0xcafebabe ||
    binary.readUInt32BE(4) !== 2
  )
    throw new Error(`${errorPrefix}_binary_invalid`);
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
      throw new Error(`${errorPrefix}_binary_invalid`);
    slices.push({ cpu, offset, size });
  }
  return manifest;
}
