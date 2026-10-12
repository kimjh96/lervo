import { nativeFileSyncDigest } from "../../shared/native-file-sync-contract.mjs";

export function nativeFileSyncFixture() {
  const binary = Buffer.alloc(112);
  binary.writeUInt32BE(0xcafebabe, 0);
  binary.writeUInt32BE(2, 4);
  for (const [index, cpu] of [0x01000007, 0x0100000c].entries()) {
    const header = 8 + index * 20,
      offset = 48 + index * 32;
    binary.writeUInt32BE(cpu, header);
    binary.writeUInt32BE(offset, header + 8);
    binary.writeUInt32BE(32, header + 12);
    binary.writeUInt32LE(0xfeedfacf, offset);
    binary.writeUInt32LE(cpu, offset + 4);
    binary.writeUInt32LE(8, offset + 12);
  }
  const manifest = {
    schemaVersion: 1,
    apiVersion: 1,
    napiVersion: 8,
    platform: "darwin",
    architectures: ["arm64", "x64"],
    sourceHash: `sha256:${"a".repeat(64)}`,
    contentHash: nativeFileSyncDigest(binary),
  };
  return { binary, manifest };
}
