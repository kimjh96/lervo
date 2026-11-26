import { createHash } from "node:crypto";

import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import {
  MAXIMUM_SOURCE_MANIFEST_BYTES,
  parseRepositoryWorkSourceManifest,
  type RepositoryWorkSourceManifest,
} from "./repository-work-source-manifest.js";

export class ConversationKnowledgeJobSourceError extends Error {
  constructor(
    readonly code: "knowledge_job_source_invalid" | "knowledge_job_source_unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationKnowledgeJobSourceError";
  }
}

/** Opens only a content-bound changed-source completion; old baseline debt needs separate review. */
export async function readConversationKnowledgeJobSource(input: {
  completion: EventEnvelope;
  artifacts: ArtifactStore;
}): Promise<RepositoryWorkSourceManifest> {
  const { completion } = input;
  if (
    completion.type !== "conversation.repository_work.completed" ||
    completion.schemaVersion !== 3 ||
    completion.payload.knowledgeDisposition !== "pending_background"
  ) {
    throw new ConversationKnowledgeJobSourceError(
      "knowledge_job_source_invalid",
      "The knowledge job has no version-3 changed-source completion.",
    );
  }
  const payload = completion.payload;
  const changedPaths = payload.changedPaths;
  const hash = payload.sourceManifestContentHash;
  const byteCount = payload.sourceManifestByteCount;
  if (
    typeof hash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(hash) ||
    typeof byteCount !== "number" ||
    !Number.isSafeInteger(byteCount) ||
    byteCount < 1 ||
    byteCount > MAXIMUM_SOURCE_MANIFEST_BYTES
  ) {
    throw new ConversationKnowledgeJobSourceError(
      "knowledge_job_source_invalid",
      "The knowledge job manifest reference is invalid.",
    );
  }
  let content: Uint8Array;
  try {
    content = await input.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  } catch (error) {
    throw new ConversationKnowledgeJobSourceError(
      "knowledge_job_source_unavailable",
      "The knowledge job manifest artifact is unavailable.",
      { cause: error },
    );
  }
  if (
    content.byteLength !== byteCount ||
    `sha256:${createHash("sha256").update(content).digest("hex")}` !== hash
  ) {
    throw new ConversationKnowledgeJobSourceError(
      "knowledge_job_source_invalid",
      "The knowledge job manifest artifact differs from its completion reference.",
    );
  }
  let manifest: RepositoryWorkSourceManifest;
  try {
    manifest = parseRepositoryWorkSourceManifest(content);
  } catch (error) {
    throw new ConversationKnowledgeJobSourceError(
      "knowledge_job_source_invalid",
      "The knowledge job manifest artifact is malformed.",
      { cause: error },
    );
  }
  if (
    manifest.repositoryRevisionBefore !== payload.repositoryRevisionBefore ||
    manifest.repositoryRevisionAfter !== payload.repositoryRevisionAfter ||
    manifest.paths.length !== payload.changedPathCount ||
    !Array.isArray(changedPaths) ||
    changedPaths.some((path) => typeof path !== "string") ||
    manifest.paths.some((entry, index) => entry.path !== changedPaths.toSorted()[index])
  ) {
    throw new ConversationKnowledgeJobSourceError(
      "knowledge_job_source_invalid",
      "The knowledge job manifest differs from its canonical completion.",
    );
  }
  return manifest;
}
