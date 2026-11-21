import {
  canonicalJson,
  practiceWritingContract,
  sanitizePracticeText,
} from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import { acquireKnowledgeProviderAdmission } from "./provider-admission.js";
import { admittedBackgroundContext } from "./background-provider.js";
import { reservePracticeBudget, releaseUnattemptedPracticeBudget } from "./practice-budget.js";
import type { ProviderOutputSchema, ProviderJsonRequest } from "@lervo/schemas";

export interface PracticeProviderRequest {
  context: InstructionCaptureContext;
  kind: "assessment" | "draft" | "review";
  key: string;
  data: unknown;
  schema: ProviderOutputSchema;
  prompt: string;
  beforeCall?(): Promise<void>;
}

/**
 * Acquire scarce resources before creating or leasing workforce work. Local privacy and size
 * preflight runs first, so provider admission never masks or delays a private request.
 */
export async function preparePracticeProvider(input: PracticeProviderRequest) {
  const serialized = canonicalJson(input.data);
  if (Buffer.byteLength(serialized) > 32 * 1024 || sanitizePracticeText(serialized) !== serialized)
    throw new Error("source_incomplete");
  await input.beforeCall?.();
  if (input.context.providerQuantum !== undefined && input.context.providerQuantum.remaining <= 0)
    throw new Error("provider_not_admitted");
  if (await input.context.liveWorkPending()) throw new Error("foreground_pending");
  // ADR-0536: the delegation bounds provider fallback, and the lock covers the selected provider.
  const context = await admittedBackgroundContext(input.context);
  const admission = await acquireKnowledgeProviderAdmission({
    repositoryRoot: context.storage.paths.repositoryRoot,
    provider: context.provider,
    liveWorkPending: context.liveWorkPending,
    ...(context.admissionDirectory === undefined ? {} : { directory: context.admissionDirectory }),
  });
  if (!admission) throw new Error("provider_not_admitted");
  try {
    const request = {
      writingContract: practiceWritingContract,
      task: `practice_${input.kind}`,
      responseContract: { schemaVersion: 1, schema: input.schema },
      untrustedData: input.data,
    } satisfies ProviderJsonRequest;
    const reservation = await reservePracticeBudget({
      projectId: context.storage.manifest.projectId,
      kind: input.kind,
      inputBytes: Buffer.byteLength(canonicalJson(request)) + Buffer.byteLength(input.prompt),
      outputTokens: 4096,
      now: context.now(),
      ...(context.admissionDirectory === undefined
        ? {}
        : { directory: context.admissionDirectory }),
    });
    if (!reservation) throw new Error("practice_budget_exhausted");
    let attempted = false;
    return {
      context,
      admission,
      reservation,
      request,
      markAttempted: () => {
        attempted = true;
      },
      release: async () => {
        try {
          if (!attempted) await releaseUnattemptedPracticeBudget(reservation);
        } finally {
          await admission.release();
        }
      },
    };
  } catch (error) {
    await admission.release();
    throw error;
  }
}

export type PreparedPracticeProvider = Awaited<ReturnType<typeof preparePracticeProvider>>;
