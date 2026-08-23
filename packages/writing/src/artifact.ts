import type { ArtifactStore } from "@lervo/storage-contract";

import { writingSha256 } from "./integrity.js";
import {
  WritingPublicationError,
  type WritingArtifactCoordinate,
  type WritingEvaluationArtifactCoordinate,
} from "./types.js";

const MAXIMUM_WRITING_BYTES = 4 * 1024 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function expectedCoordinates(contentHash: string): { artifactId: string; uri: string } {
  const digest = contentHash.slice("sha256:".length);
  return { artifactId: `art_${digest}`, uri: `lervo-cas://sha256/${digest}` };
}

export async function readWritingArtifact(
  store: ArtifactStore,
  artifact: WritingArtifactCoordinate,
): Promise<string> {
  const expected = expectedCoordinates(artifact.contentHash);
  if (
    artifact.mediaType !== "text/markdown; charset=utf-8" ||
    !SHA256.test(artifact.contentHash) || !Number.isSafeInteger(artifact.byteCount) ||
    artifact.byteCount < 1 || artifact.byteCount > MAXIMUM_WRITING_BYTES ||
    artifact.artifactId !== expected.artifactId || artifact.uri !== expected.uri
  ) {
    throw new WritingPublicationError(
      "artifact_contract_invalid",
      "The writing artifact coordinates or size differ from the publication verification contract.",
    );
  }
  try {
    const bytes = new Uint8Array(await store.get(artifact.uri));
    if (
      bytes.byteLength !== artifact.byteCount ||
      writingSha256(bytes) !== artifact.contentHash
    ) {
      throw new Error("artifact bytes mismatch");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof WritingPublicationError) throw error;
    throw new WritingPublicationError(
      "artifact_storage_failed",
      "The writing artifact could not be read and verified safely.",
      { cause: error },
    );
  }
}

export async function storeWritingEvaluation(
  store: ArtifactStore,
  bytes: Uint8Array,
): Promise<WritingEvaluationArtifactCoordinate> {
  try {
    const expectedHash = writingSha256(bytes);
    const expected = expectedCoordinates(expectedHash);
    const stored = await store.put(bytes);
    const restored = new Uint8Array(await store.get(stored.uri));
    if (
      stored.uri !== expected.uri || stored.contentHash !== expectedHash ||
      stored.byteCount !== bytes.byteLength || restored.byteLength !== bytes.byteLength ||
      !Buffer.from(restored).equals(Buffer.from(bytes))
    ) {
      throw new Error("evaluation artifact verification failed");
    }
    return {
      ...expected,
      mediaType: "application/vnd.lervo.writing-evaluation+json; charset=utf-8",
      contentHash: expectedHash,
      byteCount: bytes.byteLength,
    };
  } catch (error) {
    throw new WritingPublicationError(
      "artifact_storage_failed",
      "The writing evaluation artifact could not be stored and reverified safely.",
      { cause: error },
    );
  }
}

export async function verifyEvaluationArtifact(
  store: ArtifactStore,
  artifact: WritingEvaluationArtifactCoordinate,
  expectedBytes: Uint8Array,
): Promise<void> {
  const expectedHash = writingSha256(expectedBytes);
  const expected = expectedCoordinates(expectedHash);
  try {
    const restored = new Uint8Array(await store.get(artifact.uri));
    if (
      artifact.mediaType !== "application/vnd.lervo.writing-evaluation+json; charset=utf-8" ||
      artifact.artifactId !== expected.artifactId || artifact.uri !== expected.uri ||
      artifact.contentHash !== expectedHash || artifact.byteCount !== expectedBytes.byteLength ||
      !Buffer.from(restored).equals(Buffer.from(expectedBytes))
    ) throw new Error("evaluation artifact mismatch");
  } catch (error) {
    throw new WritingPublicationError(
      "publication_permit_invalid",
      "The writing evaluation artifact differs from the evaluation in the permit.",
      { cause: error },
    );
  }
}
