import { pauseKnowledgeProviderFailure } from "./provider-failure-pause.js";
import { admittedBackgroundContext, backgroundProviderOptions } from "./background-provider.js";
import { documentIdForPath } from "@lervo/context";
import { createTurnMeasurement, recordTurnMeasurement } from "@lervo/execution-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  documentFreshnessGenerationInstruction,
  documentFreshnessResponseSchema,
} from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  KnowledgeProviderAvailabilityError,
  type ProviderJsonUsage,
} from "@lervo/repository-knowledge-compiler";

import { knowledgeReviewCallCeiling } from "./change-review-host.js";
import type { FreshnessEvidenceBundleV1 } from "./freshness-evidence-bundle.js";
import { acquireKnowledgeProviderAdmission } from "./provider-admission.js";

export const DOCUMENT_FRESHNESS_TASK = "document_freshness_candidate";
export const DOCUMENT_FRESHNESS_STAGE = "document_freshness";
const GENERATION_TIMEOUT_MILLISECONDS = 300_000;
const nativeCounterSemantics = {
  codex: "codex.exec-json.turn-completed.usage",
  claude: "claude.json.result.model-usage",
} as const;

export interface FreshnessGenerationContext {
  storage: ProjectStorage;
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  signal: AbortSignal;
  liveWorkPending(): Promise<boolean>;
  now(): Date;
  providerQuantum?: { remaining: number };
}

export type FreshnessGenerationResult =
  | {
      status: "generated";
      provider: "codex" | "claude";
      value: unknown;
      usage: ProviderJsonUsage | null;
    }
  | { status: "failed"; usage: null }
  | {
      status: "deferred";
      reason:
        | "knowledge_authority_unavailable"
        | "knowledge_capacity_unavailable"
        | "knowledge_provider_paused"
        | "provider_not_admitted";
    };

/** One document a freshness call injected, measured by its hash and injected byte count. */
export interface FreshnessMeasuredDocument {
  path: string;
  hash: string;
  text: string;
}

/** What one call sends: the source data and the documents it injects for ADR-0459 measurement. */
export interface FreshnessCallSource {
  sourceData: unknown;
  documents: FreshnessMeasuredDocument[];
  sourceRevision: string;
}

/** The generation bundle as a call source: the stale document and its related documents. */
export function freshnessBundleCallSource(bundle: FreshnessEvidenceBundleV1): FreshnessCallSource {
  return {
    sourceData: bundle,
    documents: [
      { path: bundle.document.path, hash: bundle.document.hash, text: bundle.document.text },
      ...bundle.relatedDocuments.map((document) => ({
        path: document.path,
        hash: document.hash,
        text: document.excerpt,
      })),
    ],
    sourceRevision: bundle.document.hash,
  };
}

/** The ADR-0459 run identifier of one freshness call, correlating its usage record. */
export function freshnessCallRunId(generationId: string): string {
  return `run_freshness_${generationId.slice("kfg_".length)}`;
}

/**
 * ADR-0459 measurement for one freshness call: the documents Lervo injected and the
 * provider-reported usage, attributed to `knowledge_worker` / `document_freshness`. Missing
 * usage is recorded as unavailable, never as zero.
 */
async function recordFreshnessUsage(input: {
  context: FreshnessGenerationContext;
  generationId: string;
  source: FreshnessCallSource;
  admissionObservationHash: string;
  usage: ProviderJsonUsage | null;
}): Promise<void> {
  const documents = input.source.documents;
  const measurement = createTurnMeasurement({
    coordinates: {
      projectId: input.context.storage.manifest.projectId,
      runId: freshnessCallRunId(input.generationId),
      sessionId: `ses_freshness_${input.generationId.slice("kfg_".length)}`,
    },
    attribution: {
      agentId: null,
      conversationDigest: null,
      channel: "knowledge_worker",
      turnEventId: input.generationId,
      stage: DOCUMENT_FRESHNESS_STAGE,
    },
    source: {
      provider: input.context.provider,
      adapterId: `${input.context.provider}/no-capability-json`,
      adapterVersion: "1",
      nativeCounterSemanticsId: nativeCounterSemantics[input.context.provider],
      requestedModel: null,
      providerSessionId: input.admissionObservationHash,
    },
    usage:
      input.usage === null
        ? { status: "unavailable", reasonCode: "knowledge_usage_unavailable" }
        : { status: "observed", source: "provider_reported", usage: input.usage },
    context: {
      sourceRevision: input.source.sourceRevision,
      documents: [...new Map(documents.map((document) => [document.path, document])).values()].map(
        (document) => ({
          documentId: documentIdForPath(document.path),
          contentHash: document.hash,
          byteCount: Buffer.byteLength(document.text, "utf8"),
          ruleId: "knowledge_worker.document_freshness",
        }),
      ),
    },
    occurredAt: input.context.now().toISOString(),
  });
  await recordTurnMeasurement(input.context.storage, measurement);
}

/**
 * One governed provider call: background spend needs the reviewed convergence delegation, the
 * shared host admission, and an unpaused provider. The no-capability adapter performs the call,
 * so the provider never receives tools, and usage is recorded whether the call succeeds or not.
 */
export async function generateFreshnessProposal(input: {
  context: FreshnessGenerationContext;
  /** The generation bundle, or any other bounded call source such as a cross-check input. */
  source: FreshnessEvidenceBundleV1 | FreshnessCallSource;
  generationId: string;
  task?: string;
  responseSchema?: unknown;
  prompt?: string;
}): Promise<FreshnessGenerationResult> {
  if (input.context.providerQuantum !== undefined && input.context.providerQuantum.remaining <= 0)
    return { status: "deferred", reason: "knowledge_capacity_unavailable" };
  const source =
    "sourceData" in input.source ? input.source : freshnessBundleCallSource(input.source);
  let context;
  try {
    context = await admittedBackgroundContext(input.context);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code === "provider_not_admitted" ||
      code === "knowledge_provider_paused" ||
      code === "knowledge_capacity_unavailable" ||
      code === "knowledge_authority_unavailable"
    )
      return { status: "deferred", reason: code };
    throw error;
  }

  try {
    await knowledgeReviewCallCeiling({
      storage: context.storage,
      provider: context.provider,
      now: context.now,
    });
  } catch {
    return { status: "deferred", reason: "knowledge_authority_unavailable" };
  }
  let admission: Awaited<ReturnType<typeof acquireKnowledgeProviderAdmission>>;
  try {
    admission = await acquireKnowledgeProviderAdmission({
      repositoryRoot: context.storage.paths.repositoryRoot,
      provider: context.provider,
      liveWorkPending: () => context.liveWorkPending(),
      ...(context.admissionDirectory === undefined
        ? {}
        : { directory: context.admissionDirectory }),
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === "knowledge_provider_paused")
      return { status: "deferred", reason: "knowledge_provider_paused" };
    throw error;
  }
  if (admission === null) return { status: "deferred", reason: "knowledge_capacity_unavailable" };
  if (context.providerQuantum !== undefined) context.providerQuantum.remaining -= 1;
  try {
    let result: { value: unknown; usage: ProviderJsonUsage | null };
    let runner: Awaited<ReturnType<typeof createNoCapabilityProviderJsonRunner>>;
    try {
      runner = await createNoCapabilityProviderJsonRunner({
        ...backgroundProviderOptions(context),
        systemPrompt: input.prompt ?? documentFreshnessGenerationInstruction,
        timeoutMs: GENERATION_TIMEOUT_MILLISECONDS,
      });
    } catch {
      // The version check and the no-capability probe run before any model call. Their failure
      // means the provider is not usable here: defer without spend, never record a rejected
      // candidate or count an attempt against the zero-success window.
      return { status: "deferred", reason: "provider_not_admitted" };
    }
    try {
      const request = {
        schemaVersion: 1,
        task: input.task ?? DOCUMENT_FRESHNESS_TASK,
        responseContract: {
          schemaVersion: 1,
          schema: input.responseSchema ?? documentFreshnessResponseSchema,
        },
        untrustedSourceData: source.sourceData,
      };
      result =
        runner.resolveObserved === undefined
          ? { value: await runner.resolve(request, context.signal), usage: null }
          : await runner.resolveObserved(request, context.signal);
    } catch (error) {
      await recordFreshnessUsage({
        context,
        generationId: input.generationId,
        source,
        admissionObservationHash: admission.observationHash,
        usage: null,
      });
      if (error instanceof KnowledgeProviderAvailabilityError) {
        await pauseKnowledgeProviderFailure(context, error);
        return { status: "deferred", reason: "knowledge_provider_paused" };
      }
      return { status: "failed", usage: null };
    }
    await recordFreshnessUsage({
      context,
      generationId: input.generationId,
      source,
      admissionObservationHash: admission.observationHash,
      usage: result.usage,
    });
    return {
      status: "generated",
      provider: context.provider,
      value: result.value,
      usage: result.usage,
    };
  } finally {
    await admission.release();
  }
}
