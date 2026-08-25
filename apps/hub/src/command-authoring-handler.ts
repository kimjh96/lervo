import type { IncomingMessage, ServerResponse } from "node:http";

import {
  authorHubCommand,
  loadLeasedHubCommandArtifact,
  type HubCommandArtifactStore,
  type HubCommandAuthoringStore,
  type HubCommandSigner,
} from "@lervo/hub-command";
import type { RemoteCommandTarget } from "@lervo/schemas";

import { readBoundedJsonBody } from "./body.js";
import { remoteCommandSubmissionBody } from "./command-request.js";
import { sendHubError, sendHubJson } from "./response.js";

export interface HubCommandAuthoringHttpOptions {
  store: HubCommandAuthoringStore;
  artifacts: HubCommandArtifactStore;
  signer: HubCommandSigner;
}

export async function handleHubCommandSubmission(input: {
  request: IncomingMessage;
  response: ServerResponse;
  authoring: HubCommandAuthoringHttpOptions;
  destinationId: string;
  target: RemoteCommandTarget;
  principalId: string;
  authoredAt: string;
  maxRequestBytes: number;
  maxResponseBytes: number;
  identityHeaders: Record<string, string>;
}): Promise<void> {
  const request = remoteCommandSubmissionBody(
    await readBoundedJsonBody(input.request, input.maxRequestBytes),
  );
  const authored = await authorHubCommand({
    ...input.authoring,
    destinationId: input.destinationId,
    target: input.target,
    principalId: input.principalId,
    authoredAt: input.authoredAt,
    request,
  });
  sendHubJson(
    input.response,
    authored.status === "created" ? 201 : 200,
    {
      schemaVersion: 1,
      status: authored.status,
      destinationId: input.destinationId,
      target: authored.record.target,
      deliveryId: authored.record.deliveryId,
      queuedAt: authored.record.queuedAt,
      envelope: authored.record.envelope,
    },
    input.maxResponseBytes,
    input.identityHeaders,
  );
}

export async function handleHubCommandArtifactDownload(input: {
  response: ServerResponse;
  authoring: HubCommandAuthoringHttpOptions;
  destinationId: string;
  target: RemoteCommandTarget;
  nodeId: string;
  artifactId: string;
  requestedAt: string;
  maxResponseBytes: number;
  identityHeaders: Record<string, string>;
}): Promise<void> {
  const artifact = await loadLeasedHubCommandArtifact({
    store: input.authoring.store,
    artifacts: input.authoring.artifacts,
    destinationId: input.destinationId,
    target: input.target,
    nodeId: input.nodeId,
    artifactId: input.artifactId,
    requestedAt: input.requestedAt,
  });
  if (artifact === null) {
    sendHubError(input.response, 404, "not_found", input.maxResponseBytes, input.identityHeaders);
    return;
  }
  if (artifact.bytes.byteLength > input.maxResponseBytes) {
    sendHubError(
      input.response,
      500,
      "response_too_large",
      input.maxResponseBytes,
      input.identityHeaders,
    );
    return;
  }
  input.response.writeHead(200, {
    ...input.identityHeaders,
    "cache-control": "no-store",
    "content-type": artifact.reference.mediaType,
    "content-length": String(artifact.bytes.byteLength),
    "x-content-type-options": "nosniff",
    "x-lervo-artifact-id": artifact.reference.artifactId,
    "x-lervo-content-hash": artifact.reference.contentHash,
  });
  input.response.end(artifact.bytes);
}
