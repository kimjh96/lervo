import type { ArtifactStore } from "@lervo/storage-contract";

import { verificationSha256 } from "./integrity.js";
import { VerificationError } from "./types.js";

export interface StoredVerificationBytes {
  artifactId: string;
  uri: string;
  contentHash: string;
  byteCount: number;
}

export async function storeVerificationBytes(
  store: ArtifactStore,
  bytes: Uint8Array,
): Promise<StoredVerificationBytes> {
  try {
    const expectedHash = verificationSha256(bytes);
    const expectedUri = `lervo-cas://sha256/${expectedHash.slice("sha256:".length)}`;
    const stored = await store.put(bytes);
    const restored = new Uint8Array(await store.get(stored.uri));
    if (
      stored.uri !== expectedUri || stored.contentHash !== expectedHash ||
      stored.byteCount !== bytes.byteLength || restored.byteLength !== bytes.byteLength ||
      !Buffer.from(restored).equals(Buffer.from(bytes))
    ) {
      throw new Error("artifact verification failed");
    }
    return {
      artifactId: `art_${expectedHash.slice("sha256:".length)}`,
      uri: stored.uri,
      contentHash: expectedHash,
      byteCount: bytes.byteLength,
    };
  } catch (error) {
    throw new VerificationError(
      "artifact_storage_failed",
      "The verification artifact could not be stored and reverified safely.",
      { cause: error },
    );
  }
}
