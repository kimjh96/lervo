import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

export const CONVERGENCE_OWNER_EVENT_SCHEMA_VERSION = 4;
const POLICY_VERSION = sha256("lervo.knowledge-convergence-owner.v1");

export type ConvergenceOwnerChangeReason =
  "lease" | "expiry" | "release" | "delegation" | "standalone";

export interface ConvergenceOwnerChange {
  repositoryIdentityHash: string;
  holderHostHash: string | null;
  previousHolderHostHash: string | null;
  observerHostHash: string;
  generation: number | null;
  mode: "hub" | "standalone";
  reason: ConvergenceOwnerChangeReason;
  occurredAt: string;
}

function hex(value: string, length: number): string {
  return sha256(value).slice("sha256:".length, "sha256:".length + length);
}

/**
 * Appends `knowledge.convergence.owner.changed` to this host's event store. Hub generations are
 * unique, so a retried append after a crash is deduplicated; standalone holders have no
 * generation and bind the observation time instead. Returns false when the store cannot accept
 * schema-4 events; ownership itself never depends on the event.
 */
export function recordConvergenceOwnerChange(
  storage: Pick<ProjectStorage, "events" | "manifest" | "writableEventSchemaVersion">,
  change: ConvergenceOwnerChange,
): boolean {
  if ((storage.writableEventSchemaVersion ?? 1) < CONVERGENCE_OWNER_EVENT_SCHEMA_VERSION)
    return false;
  const identity = canonicalJson({
    ...change,
    occurredAt: change.generation === null ? change.occurredAt : null,
  });
  const scope = hex(`lervo.convergence-owner\0${change.repositoryIdentityHash}`, 24);
  const eventId = `evt_${hex(`knowledge.convergence.owner.changed\0${identity}`, 32)}`;
  if (storage.events.get(eventId) !== null) return true;
  storage.events.append({
    eventId,
    projectId: storage.manifest.projectId,
    runId: `run_convergence_owner_${scope}`,
    sessionId: `ses_convergence_owner_${scope}`,
    occurredAt: change.occurredAt,
    actor: { kind: "system" },
    schemaVersion: CONVERGENCE_OWNER_EVENT_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    type: "knowledge.convergence.owner.changed",
    payload: { ...change },
  });
  return true;
}
