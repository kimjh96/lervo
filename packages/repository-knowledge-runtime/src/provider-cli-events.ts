import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import {
  providerCliExposedTools,
  providerCliRejectionReasons,
  type ProviderCliRejectedEventPayload,
} from "@lervo/schemas";
import type { ProviderCliIdentity } from "./provider-cli-identity.js";
import type { ProviderCliCache } from "./provider-cli-store.js";

/** Events are replayable per project even when this host's private admission cache is shared. */
export function recordProviderCliAdmission(
  storage: ProjectStorage,
  entry: ProviderCliCache["entries"][number] & { identity: ProviderCliIdentity },
  hostLabel: string,
): void {
  if ((storage.writableEventSchemaVersion ?? 1) < 4) return;
  const { identity, result, probedAt } = entry;
  const common = {
    provider: identity.provider,
    version: identity.version,
    executableHash: identity.executableHash,
    hostLabel,
  };
  const payload = result.admitted
    ? { ...common, probeResultHash: result.probeResultHash, admittedAt: probedAt }
    : {
        ...common,
        reason: providerCliRejectionReasons.includes(result.reason)
          ? result.reason
          : "probe_failed",
        exposedTools: [
          ...new Set(
            result.exposedTools.map((name) =>
              providerCliExposedTools.includes(name as (typeof providerCliExposedTools)[number])
                ? name
                : "other",
            ),
          ),
        ].slice(0, 16) as ProviderCliRejectedEventPayload["exposedTools"],
        rejectedAt: probedAt,
      };
  const eventId = `evt_${sha256(canonicalJson([payload, result.admitted])).slice(7, 39)}`;
  if (storage.events.get(eventId) !== null) return;
  storage.events.append({
    eventId,
    projectId: storage.manifest.projectId,
    runId: "run_provider_cli_admission",
    sessionId: "ses_provider_cli_admission",
    occurredAt: probedAt,
    actor: { kind: "system" },
    schemaVersion: 4,
    policyVersion: sha256("lervo.provider-cli-admission.adr-0536.v1"),
    type: result.admitted ? "provider.cli.admitted" : "provider.cli.rejected",
    payload,
  });
}
