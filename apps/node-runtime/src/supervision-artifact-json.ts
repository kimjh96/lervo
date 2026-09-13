import { createHash } from "node:crypto";
import type { ArtifactStore } from "@lervo/storage-contract";

/** Exact bounded JSON for supervision effects and decision artifacts. */
export async function readSupervisionJsonArtifact(
  artifacts: ArtifactStore,
  hash: string,
): Promise<unknown> {
  return JSON.parse(await readSupervisionTextArtifact(artifacts, hash));
}

export async function readSupervisionTextArtifact(artifacts: ArtifactStore, hash: string) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash))
    throw new Error("The supervision artifact hash is invalid.");
  const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  if (
    bytes.byteLength > 256 * 1024 ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== hash
  )
    throw new Error("The supervision artifact is unavailable or corrupt.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
