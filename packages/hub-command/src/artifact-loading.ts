import { createHash } from "node:crypto";

import type { RemoteCommandPayloadReference, RemoteCommandTarget } from "@lervo/schemas";

import { HubCommandError } from "./errors.js";
import type { HubCommandArtifactStore, HubCommandAuthoringStore } from "./types.js";

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function loadLeasedHubCommandArtifact(input: {
  store: HubCommandAuthoringStore;
  artifacts: HubCommandArtifactStore;
  destinationId: string;
  target: RemoteCommandTarget;
  nodeId: string;
  artifactId: string;
  requestedAt: string;
}): Promise<{ bytes: Uint8Array; reference: RemoteCommandPayloadReference } | null> {
  const binding = await input.store.findLeasedArtifact(input);
  if (binding === null) return null;
  let bytes: Uint8Array;
  try {
    bytes = await input.artifacts.get(binding.uri);
  } catch (error) {
    throw new HubCommandError("artifact_store_failed", "The Hub command artifact could not be read.", {
      cause: error,
    });
  }
  if (
    !(bytes instanceof Uint8Array) || bytes.byteLength !== binding.reference.byteCount ||
    sha256(bytes) !== binding.reference.contentHash
  ) {
    throw new HubCommandError("artifact_integrity_failed", "The Hub command artifact source differs from its coordinates.");
  }
  return { bytes, reference: structuredClone(binding.reference) };
}
