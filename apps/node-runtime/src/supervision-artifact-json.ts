import { createHash } from "node:crypto";
import type { ArtifactStore } from "@lervo/storage-contract";

/** Exact bounded JSON for supervision effects and decision artifacts. */
export async function readSupervisionJsonArtifact(
  artifacts: ArtifactStore,
  hash: string,
): Promise<unknown> {
  return JSON.parse(await readSupervisionTextArtifact(artifacts, hash));
}

/**
 * Supervision artifacts are bounded at 1 MiB. A long goal's canonical owner context grew past the
 * former 256 KiB with its cancelled and replaced assignments; the provider prompt stays compact.
 */
export const MAXIMUM_SUPERVISION_ARTIFACT_BYTES = 1024 * 1024;

export async function readSupervisionTextArtifact(artifacts: ArtifactStore, hash: string) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash))
    throw new Error("The supervision artifact hash is invalid.");
  const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  if (
    bytes.byteLength > MAXIMUM_SUPERVISION_ARTIFACT_BYTES ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== hash
  )
    throw new Error("The supervision artifact is unavailable or corrupt.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
