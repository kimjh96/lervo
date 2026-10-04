import {
  canonicalJson,
  sha256,
  type RepositoryKnowledgeReviewJob,
} from "@lervo/repository-knowledge";
import type { ProviderJsonUsage } from "@lervo/repository-knowledge-compiler";
import { validateSchema } from "@lervo/schemas";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";

function hex(value: string, length: number): string {
  return sha256(value).slice(7, 7 + length);
}

/**
 * Records one `resource.usage.recorded` for one per-change review call, attributed to the
 * `knowledge_worker` channel and the change event (ADR-0459). An unavailable observation is still
 * recorded, so missing measurement stays visible.
 */
export async function recordChangeReviewUsage(input: {
  events: OutboxStore;
  artifacts: ArtifactStore;
  job: RepositoryKnowledgeReviewJob;
  callOrdinal: number;
  descriptor: Record<string, unknown> & { provider: "claude" | "codex"; accountingMode: string };
  usage: ProviderJsonUsage | null;
  reasonCode: string | null;
  occurredAt: string;
}): Promise<"observed" | "unavailable" | "invalid"> {
  if (!validateSchema("resourceAccountingDescriptor", input.descriptor).valid)
    throw new KnowledgeConvergenceRuntimeError("knowledge_usage_unavailable");
  const descriptorBytes = canonicalJson(input.descriptor);
  const stored = await input.artifacts.put(descriptorBytes);
  const descriptorHash = sha256(descriptorBytes);
  if (stored.contentHash !== descriptorHash)
    throw new KnowledgeConvergenceRuntimeError("knowledge_usage_unavailable");
  const change = input.events.get(input.job.changeEventId);
  if (change === null) throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  const coordinate = `${input.job.changeEventId}\0${input.job.destinationId}\0${input.callOrdinal}`;
  const resourceObservationId = `ruo_${hex(`repository-change-review\0${coordinate}`, 24)}`;
  const usageValid =
    input.usage !== null &&
    input.usage.cachedInputTokens <= input.usage.inputTokens &&
    input.usage.reasoningOutputTokens <= input.usage.outputTokens &&
    input.usage.totalTokens === input.usage.inputTokens + input.usage.outputTokens;
  const observation =
    input.usage === null
      ? {
          status: "unavailable" as const,
          usage: null,
          reasonCode: input.reasonCode ?? "knowledge_usage_unavailable",
        }
      : usageValid
        ? { status: "observed" as const, usage: input.usage, reasonCode: null }
        : { status: "invalid" as const, usage: null, reasonCode: "invalid_provider_usage" };
  input.events.append({
    eventId: `evt_${hex(resourceObservationId, 32)}`,
    projectId: change.projectId,
    runId: change.runId,
    sessionId: change.sessionId,
    occurredAt: input.occurredAt,
    actor: { kind: "provider", provider: input.descriptor.provider },
    schemaVersion: 3,
    policyVersion: change.policyVersion,
    type: "resource.usage.recorded",
    payload: {
      workId: `wrk_${hex(`repository-change\0${input.job.changeEventId}`, 24)}`,
      resourceObservationId,
      sourceCoordinateDigest: sha256(canonicalJson({ descriptorHash, coordinate })),
      scope: "primary_provider",
      source: "provider_reported",
      accountingMode: input.descriptor.accountingMode,
      accountingDescriptorHash: descriptorHash,
      modelIdentity: {
        provider: input.descriptor.provider,
        requestedModel: null,
        answerModel: null,
        observedModelIds: [],
        answerModelEvidence: "unavailable",
        unavailableReason: "provider_model_unavailable",
      },
      ...observation,
      agentId: null,
      channel: "knowledge_worker",
      turnEventId: input.job.changeEventId,
      conversationDigest: null,
      stage: "repository_change_review",
    },
  });
  return observation.status;
}
