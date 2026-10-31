import { pauseKnowledgeProviderFailure } from "./provider-failure-pause.js";
import { recordProviderCliProbeUsage } from "./provider-cli-probe-usage.js";
import {
  probeProviderCli,
  KnowledgeProviderAvailabilityError,
} from "@lervo/repository-knowledge-compiler";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  acquireKnowledgeProviderAdmission,
  knowledgeProviderAdmissionState,
  settleKnowledgeProviderProbe,
} from "./provider-admission.js";
import { probeProviderPauseAvailability } from "./provider-pause-availability.js";
import { reserveConvergenceProviderCall } from "./provider-budget.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { ProviderCliIdentity } from "./provider-cli-identity.js";

/** Due pause recovery uses the same host slots, delegated spend and native usage as admission. */
export async function probeBackgroundProviderCli(input: {
  storage: ProjectStorage;
  identity: ProviderCliIdentity;
  delegationHash: string;
  maximumCalls: number;
  liveWorkPending(): Promise<boolean>;
  admissionDirectory?: string;
}) {
  const { identity } = input;
  const directory =
    input.admissionDirectory === undefined ? {} : { directory: input.admissionDirectory };
  const prior = await knowledgeProviderAdmissionState({
    provider: identity.provider,
    ...directory,
  });
  const recovery = prior.paused && prior.resetAt === null;

  const admission = await acquireKnowledgeProviderAdmission({
    repositoryRoot: input.storage.paths.repositoryRoot,
    provider: identity.provider,
    ...(recovery ? { purpose: "pause_reprobe" as const } : {}),
    liveWorkPending: input.liveWorkPending,
    ...(input.admissionDirectory === undefined ? {} : { directory: input.admissionDirectory }),
  });
  if (admission === null)
    throw new KnowledgeConvergenceRuntimeError("knowledge_capacity_unavailable");
  try {
    if (identity.provider === "codex") {
      const contract = await probeProviderCli(identity);
      if (!contract.admitted || !recovery) return contract;
    }
    await reserveConvergenceProviderCall({
      repositoryRoot: input.storage.paths.repositoryRoot,
      events: input.storage.events,
      obligationId: input.delegationHash,
      batchId: `provider-cli-admission:${input.delegationHash}`,
      maximumCalls: input.maximumCalls,
    });
    let observed = false;
    const observeUsage: NonNullable<
      Parameters<typeof probeProviderCli>[0]["observeUsage"]
    > = async (usage) => {
      observed = usage !== null;
      await recordProviderCliProbeUsage(input.storage, identity, admission.observationHash, usage);
    };
    const result =
      identity.provider === "codex"
        ? await probeProviderPauseAvailability(identity, observeUsage)
        : await probeProviderCli({ ...identity, observeUsage });
    if (result.admitted && !observed)
      return { admitted: false as const, reason: "probe_failed" as const, exposedTools: [] };
    if (
      result.admitted &&
      recovery &&
      !(await settleKnowledgeProviderProbe({
        provider: identity.provider,
        priorObservationHash: prior.observationHash,
        priorObservedAt: prior.observedAt,
        observationHash: result.probeResultHash,
        ...directory,
      }))
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_provider_paused");
    return result;
  } catch (error) {
    if (error instanceof KnowledgeProviderAvailabilityError)
      await pauseKnowledgeProviderFailure({ ...input, provider: identity.provider }, error);
    throw error;
  } finally {
    await admission.release();
  }
}
