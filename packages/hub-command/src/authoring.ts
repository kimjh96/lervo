import { randomBytes } from "node:crypto";
import {
  assertSignedRemoteCommand,
  calculateRemoteCommandDeliveryId,
  createRemoteCommand,
} from "@lervo/remote-command-contract";
import type { RemoteCommandPayloadReference, RemoteCommandTarget } from "@lervo/schemas";

import {
  calculateHubCommandArtifactId,
  calculateHubCommandSubmissionHash,
  hashHubCommandValue,
  validateHubCommandAuthoringInput,
} from "./command-input.js";
import { HubCommandError } from "./errors.js";
import type {
  AuthorHubCommandRequest,
  HubCommandArtifactStore,
  HubCommandAuthoringStore,
  HubCommandAuthorshipRecord,
  HubCommandSigner,
} from "./types.js";

function sameSubmission(record: HubCommandAuthorshipRecord, submissionHash: string) {
  if (record.submissionHash !== submissionHash) {
    throw new HubCommandError(
      "idempotency_conflict",
      "같은 idempotency key에 다른 command 요청이 이미 있습니다.",
    );
  }
  assertSignedRemoteCommand(record.envelope);
  return { status: "duplicate" as const, record: structuredClone(record) };
}

async function storeAndVerifyArtifact(input: {
  artifacts: HubCommandArtifactStore;
  bytes: Uint8Array;
  contentHash: string;
  expectedUri?: string;
}): Promise<string> {
  try {
    const stored = await input.artifacts.put(input.bytes);
    if (input.expectedUri !== undefined && stored.uri !== input.expectedUri) {
      throw new HubCommandError("artifact_integrity_failed", "Hub command artifact URI가 원본과 다릅니다.");
    }
    const restored = await input.artifacts.get(stored.uri);
    if (
      !(restored instanceof Uint8Array) || stored.contentHash !== input.contentHash ||
      stored.byteCount !== input.bytes.byteLength ||
      hashHubCommandValue(restored) !== input.contentHash ||
      restored.byteLength !== input.bytes.byteLength
    ) throw new HubCommandError("artifact_integrity_failed", "Hub command artifact 검증에 실패했습니다.");
    return stored.uri;
  } catch (error) {
    if (error instanceof HubCommandError) throw error;
    throw new HubCommandError("artifact_store_failed", "Hub command artifact를 저장하지 못했습니다.", {
      cause: error,
    });
  }
}

export async function authorHubCommand(input: {
  store: HubCommandAuthoringStore;
  artifacts: HubCommandArtifactStore;
  signer: HubCommandSigner;
  destinationId: string;
  target: RemoteCommandTarget;
  principalId: string;
  authoredAt: string;
  request: AuthorHubCommandRequest;
  nonce?: () => string;
}): Promise<{ status: "created" | "duplicate"; record: HubCommandAuthorshipRecord }> {
  const bytes = new TextEncoder().encode(input.request.request);
  const authorSubjectHash = validateHubCommandAuthoringInput({ ...input, bytes });
  const authoredAtMs = Date.parse(input.authoredAt);
  const contentHash = hashHubCommandValue(bytes);
  const reference: RemoteCommandPayloadReference = {
    artifactId: calculateHubCommandArtifactId({
      destinationId: input.destinationId,
      target: input.target,
      contentHash,
    }),
    contentHash,
    byteCount: bytes.byteLength,
    mediaType: "text/plain; charset=utf-8",
  };
  const submissionHash = calculateHubCommandSubmissionHash({
    destinationId: input.destinationId,
    target: input.target,
    idempotencyKey: input.request.idempotencyKey,
    roleId: input.request.roleId,
    provider: input.request.provider,
    risk: input.request.risk,
    verificationSuiteIds: input.request.verificationSuiteIds,
    lifetimeMs: input.request.lifetimeMs,
    request: reference,
  });
  const coordinate = {
    destinationId: input.destinationId,
    target: structuredClone(input.target),
    idempotencyKey: input.request.idempotencyKey,
  };
  const existing = await input.store.findAuthorship(coordinate);
  if (existing !== null) {
    const duplicate = sameSubmission(existing, submissionHash);
    await storeAndVerifyArtifact({
      artifacts: input.artifacts,
      bytes,
      contentHash,
      expectedUri: existing.artifactUri,
    });
    return duplicate;
  }
  const artifactUri = await storeAndVerifyArtifact({
    artifacts: input.artifacts,
    bytes,
    contentHash,
  });
  const nonce = (input.nonce ?? (() => randomBytes(32).toString("base64url")))();
  const command = createRemoteCommand({
    idempotencyKey: input.request.idempotencyKey,
    nonce,
    issuedAt: input.authoredAt,
    expiresAt: new Date(authoredAtMs + input.request.lifetimeMs).toISOString(),
    target: structuredClone(input.target),
    action: {
      kind: "managed_run",
      roleId: input.request.roleId,
      provider: input.request.provider,
      risk: input.request.risk,
      verificationSuiteIds: [...input.request.verificationSuiteIds],
      request: reference,
    },
  });
  const envelope = input.signer.sign(command);
  assertSignedRemoteCommand(envelope);
  if (envelope.command.commandId !== command.commandId) {
    throw new HubCommandError("invalid_request", "Hub command signer가 다른 command를 반환했습니다.");
  }
  const record: HubCommandAuthorshipRecord = {
    ...coordinate,
    submissionHash,
    authorSubjectHash,
    artifactUri,
    envelope,
    deliveryId: calculateRemoteCommandDeliveryId({
      destinationId: input.destinationId,
      envelope,
    }),
    queuedAt: input.authoredAt,
  };
  const committed = await input.store.commitAuthorship(record);
  if (committed.status === "duplicate") {
    const duplicate = sameSubmission(committed.record, submissionHash);
    await storeAndVerifyArtifact({
      artifacts: input.artifacts,
      bytes,
      contentHash,
      expectedUri: committed.record.artifactUri,
    });
    return duplicate;
  }
  return { status: "created", record: structuredClone(committed.record) };
}
