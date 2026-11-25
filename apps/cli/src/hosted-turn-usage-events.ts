// A hosted ADE session's turn usage (ADR-0632 S2b), recorded as `resource.usage.recorded` with a
// hosted-session attribution at schema 11 (Lervo ADE sessions, "Usage records"): one ledger with
// managed usage, a null work ID, and the session as a digest.
import { createHash } from "node:crypto";

import type { HostedTurnUsage } from "@lervo/adapter-contract";
import { hostedSessionUsageEventSchemaVersion, RedactionError } from "@lervo/event-contract";
import {
  resourceAccountingDescriptorBytes,
  resourceAccountingDescriptorHash,
} from "@lervo/execution-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";
import type { ResourceAccountingDescriptor } from "@lervo/schemas";

import {
  hostedLaunchRecordsPath,
  latestHostedLaunchOfSession,
  type HostedLaunchRecord,
} from "./hosted-launch-records.js";
import {
  hostedSessionRunId,
  POLICY_VERSION,
  providerSessionDigest,
  sha256,
  suffix,
} from "./hosted-session-events.js";

/** The parts of a repository's storage that recording usage needs. */
export type HostedTurnUsageStore = Pick<
  ProjectStorage,
  "manifest" | "events" | "artifacts" | "writableEventSchemaVersion"
>;

/**
 * What recording did with a batch: how many records it added, found already recorded, or
 * dropped because the event screen refused them. `storage_failed` means the store failed for
 * another reason, such as a busy database or a full disk, before every record was tried; the
 * records are deterministic, so the caller retries the batch.
 * - `inactive`: the repository's writer selects a schema below 11, so nothing is recorded and the
 *   session goes on.
 * - `descriptor_unavailable`: the accounting descriptor could not be stored and read back, so no
 *   record that would name it is written.
 */
export type HostedTurnUsageOutcome =
  | { readonly status: "inactive" | "unknown_session" | "descriptor_unavailable" }
  | {
      readonly status: "recorded" | "storage_failed";
      readonly recorded: number;
      readonly duplicates: number;
      readonly dropped: number;
    };

/** Whether an append failed because the event screen or the envelope refused the record. */
function refusedByScreen(error: unknown): boolean {
  return (
    error instanceof RedactionError ||
    (error instanceof Error &&
      error.name === "EventStoreError" &&
      (error as { code?: unknown }).code === "invalid_event")
  );
}

/**
 * The coordinate of one model's usage in one result, from the session, the provider's result ID,
 * and the model key. It names the event, the observation, and its source, so a replayed decode
 * records each result once; nothing raw is recorded.
 */
export function turnUsageCoordinate(digest: string, usage: HostedTurnUsage): string {
  return sha256(JSON.stringify([digest, usage.turnKey, usage.modelKey]));
}

/** Stores the descriptor in the repository's artifacts and reads it back before it is cited. */
async function storedDescriptorHash(
  store: HostedTurnUsageStore,
  accounting: ResourceAccountingDescriptor,
): Promise<string | null> {
  try {
    const hash = resourceAccountingDescriptorHash(accounting);
    const stored = await store.artifacts.put(resourceAccountingDescriptorBytes(accounting));
    if (stored.contentHash !== hash) return null;
    const readBack = await store.artifacts.get(stored.uri);
    return sha256Bytes(readBack) === hash ? hash : null;
  } catch {
    return null;
  }
}

function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function usagePayload(
  record: HostedLaunchRecord,
  digest: string,
  coordinate: string,
  accounting: ResourceAccountingDescriptor,
  descriptorHash: string,
  turn: HostedTurnUsage,
) {
  const inputTokens =
    turn.uncachedInputTokens + turn.cacheReadInputTokens + turn.cacheCreationInputTokens;
  const reasoningReported = turn.reasoningOutputTokens !== null;
  return {
    workId: null,
    resourceObservationId: `ruo_${coordinate.slice(7, 31)}`,
    sourceCoordinateDigest: coordinate,
    scope: "primary_provider",
    source: "provider_reported",
    accountingMode: accounting.accountingMode,
    accountingDescriptorHash: descriptorHash,
    modelIdentity:
      turn.model === null
        ? {
            provider: record.provider,
            requestedModel: null,
            answerModel: null,
            observedModelIds: [],
            answerModelEvidence: "unavailable",
            unavailableReason: "model_name_invalid",
          }
        : {
            provider: record.provider,
            requestedModel: null,
            answerModel: turn.model,
            observedModelIds: [turn.model],
            answerModelEvidence: "response_object",
            unavailableReason: null,
          },
    // Unreported reasoning is a measured zero only in name: the record says it is partial.
    status: reasoningReported ? "observed" : "partial",
    usage: {
      inputTokens,
      cachedInputTokens: turn.cacheReadInputTokens,
      outputTokens: turn.outputTokens,
      reasoningOutputTokens: turn.reasoningOutputTokens ?? 0,
      totalTokens: inputTokens + turn.outputTokens,
      contextWindow: turn.contextWindow,
    },
    reasonCode: reasoningReported ? null : "reasoning_unreported",
    hostedSession: { providerSessionDigest: digest, provider: record.provider },
    cacheCreationInputTokens: turn.cacheCreationInputTokens,
    costUsd: turn.costUsd,
    costBasis: turn.costBasis,
  };
}

/** Appends `usage` for `record`'s session to `store`, one event per result and model. */
export async function appendTurnUsage(
  store: HostedTurnUsageStore,
  record: HostedLaunchRecord,
  accounting: ResourceAccountingDescriptor,
  usage: readonly HostedTurnUsage[],
  occurredAt: string,
): Promise<HostedTurnUsageOutcome> {
  if ((store.writableEventSchemaVersion ?? 1) < hostedSessionUsageEventSchemaVersion)
    return { status: "inactive" };
  const descriptorHash = await storedDescriptorHash(store, accounting);
  if (descriptorHash === null) return { status: "descriptor_unavailable" };
  const digest = providerSessionDigest(record.provider, record.sessionId);
  let recorded = 0;
  let duplicates = 0;
  let dropped = 0;
  for (const turn of usage) {
    const coordinate = turnUsageCoordinate(digest, turn);
    const eventId = `evt_${coordinate.slice(7, 39)}`;
    if (store.events.get(eventId)) {
      duplicates += 1;
      continue;
    }
    try {
      store.events.append({
        eventId,
        projectId: store.manifest.projectId,
        runId: hostedSessionRunId(record.workspaceId),
        sessionId: `ses_hosted_${suffix(digest)}`,
        type: "resource.usage.recorded",
        schemaVersion: hostedSessionUsageEventSchemaVersion,
        occurredAt,
        actor: { kind: "system" },
        policyVersion: POLICY_VERSION,
        payload: usagePayload(record, digest, coordinate, accounting, descriptorHash, turn),
      });
      recorded += 1;
    } catch (error) {
      // A refused payload, such as reasoning above output, is never recorded in part and is
      // counted. Any other failure stops the batch so the caller can retry it.
      if (!refusedByScreen(error))
        return { status: "storage_failed", recorded, duplicates, dropped };
      dropped += 1;
    }
  }
  return { status: "recorded", recorded, duplicates, dropped };
}

/** Records `usage` for the newest launch of `sessionId`, in its registered repository. */
export async function recordHostedTurnUsage(
  sessionId: string,
  accounting: ResourceAccountingDescriptor,
  usage: readonly HostedTurnUsage[],
  now: () => Date = () => new Date(),
): Promise<HostedTurnUsageOutcome> {
  const record = await latestHostedLaunchOfSession(hostedLaunchRecordsPath(), sessionId);
  if (record === null) return { status: "unknown_session" };
  const repository = await resolveRegisteredRepository({
    registryPath: defaultRepositoryRegistryPath(),
    projectId: record.projectId,
  });
  const storage = await openProjectStorage(repository.repositoryRoot);
  try {
    return await appendTurnUsage(storage, record, accounting, usage, now().toISOString());
  } finally {
    await storage.close();
  }
}
