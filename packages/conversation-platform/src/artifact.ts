import { createHash } from "node:crypto";

import {
  assertConversationOutboundMessage,
} from "@lervo/conversation-contract";
import type {
  ConversationContentReference,
  ConversationOutboundMessage,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import { ConversationPlatformError } from "./types.js";

const MAXIMUM_CONVERSATION_BYTES = 65_536;

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function uri(contentHash: string): string {
  return `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function storeConversationText(input: {
  content: string;
  artifactStore: ArtifactStore;
}): Promise<ConversationContentReference> {
  const bytes = Buffer.from(input.content, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_CONVERSATION_BYTES) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "대화 본문 크기가 허용 범위를 벗어났습니다.",
    );
  }
  try {
    const contentHash = hash(bytes);
    const stored = await input.artifactStore.put(bytes);
    const restored = new Uint8Array(await input.artifactStore.get(stored.uri));
    if (
      stored.uri !== uri(contentHash) || stored.contentHash !== contentHash ||
      stored.byteCount !== bytes.byteLength || hash(restored) !== contentHash ||
      decode(restored) !== input.content
    ) throw new Error("stored conversation artifact mismatch");
    return {
      artifactId: `art_${contentHash.slice("sha256:".length)}`,
      contentHash,
      byteCount: bytes.byteLength,
      mediaType: "text/plain; charset=utf-8",
    };
  } catch (error) {
    if (error instanceof ConversationPlatformError) throw error;
    throw new ConversationPlatformError(
      "artifact_storage_failed",
      "대화 본문 artifact를 저장하고 확인하지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export async function readConversationOutboundText(input: {
  message: ConversationOutboundMessage;
  artifactStore: ArtifactStore;
}): Promise<string> {
  try {
    assertConversationOutboundMessage({ outbound: input.message });
    const bytes = new Uint8Array(await input.artifactStore.get(uri(input.message.content.contentHash)));
    if (
      bytes.byteLength !== input.message.content.byteCount ||
      bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_CONVERSATION_BYTES ||
      hash(bytes) !== input.message.content.contentHash
    ) throw new Error("outbound conversation artifact mismatch");
    return decode(bytes);
  } catch (error) {
    throw new ConversationPlatformError(
      "artifact_storage_failed",
      "전송할 대화 본문 artifact를 확인하지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
