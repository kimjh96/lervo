import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

/** Version 5 producers stay off until the existing reader-evidence activation proves support. */
export function appendFreshnessMaintenanceEvent(input: {
  storage: Pick<ProjectStorage, "events" | "manifest" | "writableEventSchemaVersion">;
  type: "document.freshness.evidence.recovered" | "document.freshness.assessment.recorded";
  receiptHash: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}): boolean {
  if ((input.storage.writableEventSchemaVersion ?? 1) < 5) return false;
  const identity = sha256(canonicalJson([input.type, input.receiptHash])).slice(7, 39);
  const scope = sha256(input.receiptHash).slice(7, 31);
  input.storage.events.append({
    eventId: `evt_${identity}`,
    projectId: input.storage.manifest.projectId,
    runId: `run_maintenance_${scope}`,
    sessionId: `ses_maintenance_${scope}`,
    occurredAt: input.occurredAt,
    actor: { kind: "system" },
    schemaVersion: 5,
    policyVersion: sha256("lervo.knowledge-maintenance.v1"),
    type: input.type,
    payload: {
      projectId: input.storage.manifest.projectId,
      ...input.payload,
      receiptHash: input.receiptHash,
      occurredAt: input.occurredAt,
    },
  });
  return true;
}
