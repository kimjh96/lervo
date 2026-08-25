import { createHash } from "node:crypto";

import type { ConversationContentReference } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import { ManagedConversationResponseError } from "./types.js";

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function readConversationMessage(input: {
  content: ConversationContentReference;
  artifactStore: ArtifactStore;
}): Promise<string> {
  const uri = `lervo-cas://sha256/${input.content.contentHash.slice("sha256:".length)}`;
  try {
    const bytes = new Uint8Array(await input.artifactStore.get(uri));
    if (bytes.byteLength !== input.content.byteCount || sha256(bytes) !== input.content.contentHash)
      throw new Error("message bytes mismatch");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ManagedConversationResponseError(
      "message_artifact_invalid",
      "The conversation source artifact could not be verified against its content hash.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
