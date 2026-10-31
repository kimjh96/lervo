import { randomUUID } from "node:crypto";
import { createTurnMeasurement, recordTurnMeasurement } from "@lervo/execution-contract";
import type { ProviderJsonUsage } from "@lervo/repository-knowledge-compiler";
import type { ProjectStorage } from "@lervo/project-storage";
import type { ProviderCliIdentity } from "./provider-cli-identity.js";

/** A paid admission attempt records native usage or its absence without retaining provider output. */
export async function recordProviderCliProbeUsage(
  storage: ProjectStorage,
  identity: ProviderCliIdentity,
  admissionObservationHash: string,
  usage: ProviderJsonUsage | null,
): Promise<void> {
  const id = randomUUID().replaceAll("-", "");
  await recordTurnMeasurement(
    storage,
    createTurnMeasurement({
      coordinates: {
        projectId: storage.manifest.projectId,
        runId: `run_cli_probe_${id}`,
        sessionId: `ses_cli_probe_${id}`,
      },
      attribution: {
        agentId: null,
        conversationDigest: null,
        channel: "knowledge_worker",
        turnEventId: `cli_probe_${id}`,
        stage: "provider_cli_admission",
      },
      source: {
        provider: identity.provider,
        adapterId: `${identity.provider}/no-capability-admission`,
        adapterVersion: "2",
        nativeCounterSemanticsId:
          identity.provider === "claude"
            ? "claude.json.result.model-usage"
            : "codex.exec-json.turn-completed.usage",
        requestedModel: null,
        providerSessionId: admissionObservationHash,
      },
      usage:
        usage === null
          ? { status: "unavailable", reasonCode: "knowledge_usage_unavailable" }
          : { status: "observed", source: "provider_reported", usage },
      context: { sourceRevision: identity.executableHash, documents: [] },
      occurredAt: new Date().toISOString(),
    }),
  );
}
