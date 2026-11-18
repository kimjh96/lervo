import { pauseKnowledgeProviderFailure } from "./provider-failure-pause.js";
import { admittedBackgroundContext, backgroundProviderOptions } from "./background-provider.js";
import { documentIdForPath } from "@lervo/context";
import { createTurnMeasurement, recordTurnMeasurement } from "@lervo/execution-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  instructionCaptureAssessmentInstruction,
  instructionCaptureRequest,
  canonicalJson,
  sanitizePracticeText,
  type InstructionCaptureRequestInput,
} from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  KnowledgeProviderAvailabilityError,
  type ProviderJsonUsage,
} from "@lervo/repository-knowledge-compiler";

import { knowledgeReviewCallCeiling } from "./change-review-host.js";
import { acquireKnowledgeProviderAdmission } from "./provider-admission.js";

export const INSTRUCTION_CAPTURE_STAGE = "instruction_capture";
/** Background assessment never blocks a hook, so it may wait for a slow provider start. */
const ASSESSMENT_TIMEOUT_MILLISECONDS = 120_000;
const nativeCounterSemantics = {
  codex: "codex.exec-json.turn-completed.usage",
  claude: "claude.json.result.model-usage",
} as const;

export interface InstructionCaptureContext {
  storage: ProjectStorage;
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  signal: AbortSignal;
  liveWorkPending(): Promise<boolean>;
  now(): Date;
  providerQuantum?: { remaining: number };
}

export type InstructionCaptureAssessmentCall =
  | {
      status: "assessed";
      provider: "codex" | "claude";
      value: unknown;
      usage: ProviderJsonUsage | null;
    }
  | { status: "failed" }
  | {
      status: "deferred";
      attempted?: boolean;
      reason:
        | "knowledge_authority_unavailable"
        | "knowledge_capacity_unavailable"
        | "knowledge_provider_paused"
        | "provider_not_admitted";
    };

/**
 * ADR-0459 measurement for one assessment: the canonical instructions Lervo supplied as context
 * and the provider-reported usage, attributed to `knowledge_worker` / `instruction_capture`.
 * Missing usage is recorded as unavailable, never as zero.
 */
async function recordCaptureUsage(input: {
  context: InstructionCaptureContext;
  call: GovernedCallIdentity;
  catalogEntries: ReadonlyArray<{ path: string; contentHash: string; excerpt: string }>;
  sourceRevision: string;
  admissionObservationHash: string;
  usage: ProviderJsonUsage | null;
}): Promise<void> {
  const suffix = input.call.captureId.slice("kcap_".length);
  await recordTurnMeasurement(
    input.context.storage,
    createTurnMeasurement({
      coordinates: {
        projectId: input.context.storage.manifest.projectId,
        runId: `run_${input.call.runPrefix}_${suffix}`,
        sessionId: `ses_${input.call.runPrefix}_${suffix}`,
      },
      attribution: {
        agentId: null,
        conversationDigest: null,
        channel: "knowledge_worker",
        turnEventId: `${input.call.turnEventPrefix}_${suffix}`,
        stage: input.call.stage,
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
        sourceRevision: input.sourceRevision,
        documents: input.catalogEntries.map((entry) => ({
          documentId: documentIdForPath(entry.path),
          contentHash: entry.contentHash,
          byteCount: Buffer.byteLength(entry.excerpt, "utf8"),
          ruleId: "knowledge_worker.instruction_capture",
        })),
      },
      occurredAt: input.context.now().toISOString(),
    }),
  );
}

/** Measurement coordinates of one governed call; the capture ID keeps retries idempotent. */
interface GovernedCallIdentity {
  captureId: string;
  runPrefix: string;
  turnEventPrefix: string;
  stage: string;
}

/**
 * One governed no-capability call: background spend needs the reviewed convergence delegation,
 * the shared host admission, and an unpaused provider. The adapter gives the provider no tools;
 * owner and agent turn text reach it only through process stdin and are not retained. Each call
 * runs in a fresh provider session, so a second call is independent of the first (ADR-0561).
 */
export async function runGovernedCaptureCall(input: {
  context: InstructionCaptureContext;
  call: GovernedCallIdentity;
  systemPrompt: string;
  catalogEntries: ReadonlyArray<{ path: string; contentHash: string; excerpt: string }>;
  sourceRevision: string;
  request(): Promise<unknown>;
}): Promise<InstructionCaptureAssessmentCall> {
  if (input.context.providerQuantum !== undefined && input.context.providerQuantum.remaining <= 0)
    return { status: "deferred", reason: "knowledge_capacity_unavailable" };
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
  const measured = {
    context,
    call: input.call,
    catalogEntries: input.catalogEntries,
    sourceRevision: input.sourceRevision,
    admissionObservationHash: admission.observationHash,
  };
  try {
    let result: { value: unknown; usage: ProviderJsonUsage | null };
    try {
      if (context.providerQuantum !== undefined) context.providerQuantum.remaining -= 1;
      const runner = await createNoCapabilityProviderJsonRunner({
        ...backgroundProviderOptions(context),
        systemPrompt: input.systemPrompt,
        timeoutMs: ASSESSMENT_TIMEOUT_MILLISECONDS,
      });
      const request = await input.request();
      result =
        runner.resolveObserved === undefined
          ? { value: await runner.resolve(request, context.signal), usage: null }
          : await runner.resolveObserved(request, context.signal);
    } catch (error) {
      await recordCaptureUsage({ ...measured, usage: null });
      if (error instanceof KnowledgeProviderAvailabilityError) {
        await pauseKnowledgeProviderFailure(context, error);
        return { status: "deferred", reason: "knowledge_provider_paused", attempted: true };
      }
      return { status: "failed" };
    }
    await recordCaptureUsage({ ...measured, usage: result.usage });
    return {
      status: "assessed",
      provider: context.provider,
      value: result.value,
      usage: result.usage,
    };
  } finally {
    await admission.release();
  }
}

/** The ADR-0467 assessment of one owner turn through the governed call. */
export async function assessInstructionCapture(input: {
  context: InstructionCaptureContext;
  captureId: string;
  request: InstructionCaptureRequestInput;
  catalogEntries: ReadonlyArray<{ path: string; contentHash: string; excerpt: string }>;
  sourceRevision: string;
  validatePrecedingWork?(): Promise<boolean>;
}): Promise<InstructionCaptureAssessmentCall> {
  return runGovernedCaptureCall({
    context: input.context,
    call: {
      captureId: input.captureId,
      runPrefix: "capture",
      turnEventPrefix: "kcap",
      stage: INSTRUCTION_CAPTURE_STAGE,
    },
    systemPrompt: instructionCaptureAssessmentInstruction,
    catalogEntries: input.catalogEntries,
    sourceRevision: input.sourceRevision,
    async request() {
      const captureInput = { ...input.request };
      if (input.validatePrecedingWork && !(await input.validatePrecedingWork().catch(() => false)))
        delete captureInput.precedingWork;
      if (captureInput.precedingWork !== undefined) {
        const serialized = canonicalJson(captureInput.precedingWork);
        if (sanitizePracticeText(serialized) !== serialized) delete captureInput.precedingWork;
      }
      return instructionCaptureRequest(captureInput);
    },
  });
}
