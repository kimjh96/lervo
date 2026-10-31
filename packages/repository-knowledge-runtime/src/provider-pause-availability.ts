import { randomUUID } from "node:crypto";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  type ProviderCliProbeResult,
  type ProviderJsonUsage,
  type NoCapabilityProviderJsonRunner,
} from "@lervo/repository-knowledge-compiler";
import type { ProviderCliIdentity } from "./provider-cli-identity.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** A model-input contract alone cannot prove that quota or authentication recovered. */
export async function probeProviderPauseAvailability(
  identity: ProviderCliIdentity,
  observeUsage: (usage: ProviderJsonUsage | null) => Promise<void>,
): Promise<ProviderCliProbeResult> {
  const nonce = randomUUID();
  let observed: Awaited<ReturnType<NonNullable<NoCapabilityProviderJsonRunner["resolveObserved"]>>>;
  try {
    const runner = await createNoCapabilityProviderJsonRunner({
      provider: identity.provider,
      executable: identity.executable,
      environment: identity.environment,
      timeoutMs: 60_000,
      systemPrompt:
        "Return the exact supplied nonce in the response schema. Do not perform any other work.",
    });
    if (!runner.resolveObserved)
      throw new KnowledgeConvergenceRuntimeError("knowledge_usage_unavailable");
    observed = await runner.resolveObserved({
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
    });
  } catch (error) {
    await observeUsage(null);
    const failure = error as {
      code?: string;
      processStatus?: string;
      probeFailureReason?: string;
    } | null;
    if (
      failure?.code !== "knowledge_compile_failed" &&
      failure?.code !== "knowledge_compile_policy_violation"
    )
      throw error;
    return {
      admitted: false,
      reason:
        failure.processStatus === "timed_out" || failure.probeFailureReason === "probe_timed_out"
          ? "probe_timed_out"
          : "probe_failed",
      exposedTools: [],
    };
  }
  await observeUsage(observed.usage);
  if ((observed.value as { nonce?: unknown } | null)?.nonce !== nonce || observed.usage === null)
    return { admitted: false, reason: "probe_failed", exposedTools: [] };
  return {
    admitted: true,
    probeResultHash: sha256(
      canonicalJson({
        contract: "adr-0536.pause-reprobe.v1",
        identityHash: identity.identityHash,
        nonce,
        usage: observed.usage,
      }),
    ),
  };
}
