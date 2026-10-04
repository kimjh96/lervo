import { randomUUID } from "node:crypto";
import { listAssignments } from "@lervo/agent-workforce";
import { hasCurrentForegroundLease } from "./foreground-admission.js";
import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson } from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  KnowledgeProviderAvailabilityError,
} from "@lervo/repository-knowledge-compiler";
import { assertConvergenceDelegation, loadConvergenceDelegation } from "./delegation.js";
import {
  acquireKnowledgeProviderAdmission,
  knowledgeProviderAdmissionState,
  pauseKnowledgeProvider,
  settleKnowledgeProviderProbe,
} from "./provider-admission.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Explicitly requested native observation: one capability-free call, shared admission, observed usage and exact nonce. */
export async function probeKnowledgeProviderAvailability(input: {
  storage: ProjectStorage;
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  signal?: AbortSignal;
}): Promise<{ resumed: boolean; observationHash: string }> {
  const root = input.storage.paths.repositoryRoot;
  const authority = await loadConvergenceDelegation(root);
  const validate = () =>
    assertConvergenceDelegation({
      repositoryRoot: root,
      projectId: input.storage.manifest.projectId,
      expectedHash: authority?.contentHash ?? null,
      provider: input.provider,
    });
  await validate();
  const directory =
    input.admissionDirectory === undefined ? {} : { directory: input.admissionDirectory };
  const prior = await knowledgeProviderAdmissionState({ provider: input.provider, ...directory });
  const admission = await acquireKnowledgeProviderAdmission({
    repositoryRoot: root,
    provider: input.provider,
    purpose: "availability_probe",
    ...directory,
    liveWorkPending: async () => hasCurrentForegroundLease(await listAssignments(root), Date.now()),
  });
  if (!admission) throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
  const controller = new AbortController();
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void validate()
      .catch((error: unknown) => controller.abort(error))
      .finally(() => {
        checking = false;
      });
  }, 1000);
  timer.unref();
  try {
    const nonce = randomUUID();
    const runner = await createNoCapabilityProviderJsonRunner({
      provider: input.provider,
      ...(input.executable === undefined ? {} : { executable: input.executable }),
      timeoutMs: 60_000,
      systemPrompt:
        "Return the exact supplied nonce in the response schema. This is a capability-free availability observation. Do not perform any other work.",
    });
    if (!runner.resolveObserved)
      throw new KnowledgeConvergenceRuntimeError("knowledge_usage_unavailable");
    const observed = await runner.resolveObserved(
      {
        schemaVersion: 1,
        task: "knowledge_provider_availability_probe",
        responseContract: {
          schemaVersion: 1,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { nonce: { type: "string" } },
            required: ["nonce"],
          },
        },
        untrustedSourceData: { nonce },
      },
      input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal,
    );
    if ((observed.value as { nonce?: unknown } | null)?.nonce !== nonce || observed.usage === null)
      throw new KnowledgeConvergenceRuntimeError("knowledge_usage_unavailable");
    await validate();
    const proof = await input.storage.artifacts.put(
      canonicalJson({
        schemaVersion: 1,
        kind: "native_provider_availability",
        provider: input.provider,
        nonce,
        observed,
        admissionObservationHash: admission.observationHash,
        delegationHash: authority!.contentHash,
        observedAt: new Date().toISOString(),
      }),
    );
    return {
      resumed: await settleKnowledgeProviderProbe({
        provider: input.provider,
        priorObservationHash: prior.observationHash,
        priorObservedAt: prior.observedAt,
        observationHash: proof.contentHash,
        ...directory,
      }),
      observationHash: proof.contentHash,
    };
  } catch (error) {
    if (error instanceof KnowledgeProviderAvailabilityError)
      await pauseKnowledgeProvider({
        provider: input.provider,
        reason: error.reason,
        observationHash: error.observationHash,
        resetAt: error.resetAt,
        ...directory,
      });
    throw error;
  } finally {
    clearInterval(timer);
    await admission.release();
  }
}
