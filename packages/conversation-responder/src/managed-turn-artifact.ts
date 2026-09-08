import { createHash } from "node:crypto";

import type { WritingArtifactCoordinate } from "@lervo/writing";

import type { ManagedConversationTurnResolverOptions } from "./types.js";
import { ManagedConversationResponseError } from "./types.js";

function digestBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function storeManagedConversationReply(
  options: ManagedConversationTurnResolverOptions,
  reply: string,
): Promise<WritingArtifactCoordinate> {
  const bytes = new TextEncoder().encode(reply.trim());
  const contentHash = digestBytes(bytes);
  const stored = await options.artifactStore.put(bytes);
  const restored = await options.artifactStore.get(stored.uri);
  if (
    stored.contentHash !== contentHash ||
    stored.byteCount !== bytes.byteLength ||
    Buffer.compare(Buffer.from(restored), Buffer.from(bytes)) !== 0
  ) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "The managed conversation reply artifact could not be stored and verified.",
    );
  }
  return {
    artifactId: `art_${contentHash.slice("sha256:".length)}`,
    uri: stored.uri,
    mediaType: "text/markdown; charset=utf-8",
    contentHash,
    byteCount: bytes.byteLength,
  };
}

export async function readManagedConversationTurnArtifact(
  options: ManagedConversationTurnResolverOptions,
  artifact: WritingArtifactCoordinate,
): Promise<string> {
  const bytes = await options.artifactStore.get(artifact.uri);
  if (
    artifact.mediaType !== "text/markdown; charset=utf-8" ||
    artifact.artifactId !== `art_${artifact.contentHash.slice("sha256:".length)}` ||
    bytes.byteLength !== artifact.byteCount ||
    digestBytes(bytes) !== artifact.contentHash
  ) {
    throw new ManagedConversationResponseError(
      "managed_run_invalid",
      "The managed conversation turn artifact coordinates or bytes are invalid.",
    );
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
