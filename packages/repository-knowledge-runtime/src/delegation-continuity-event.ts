import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

const EVENT_SCHEMA_VERSION = 4;
const POLICY_VERSION = sha256("lervo.knowledge-convergence-continuity.v1");

export interface DelegationContinuation {
  repositoryIdentityHash: string;
  action: "renewed" | "seeded" | "rebound";
  source: "renewal" | "peer" | "policy_template" | "binding_refresh";
  policyHash: string;
  previousPlanHash: string | null;
  planHash: string;
  scopeHash: string;
  expiresAt: string;
  observerHostHash: string | null;
  sourceHostHash: string | null;
  occurredAt: string;
}

function hex(value: string, length: number): string {
  return sha256(value).slice("sha256:".length, "sha256:".length + length);
}

/**
 * Appends `knowledge.convergence.delegation.continued` (ADR-0469). The plan hash is unique per
 * continued delegation, so a retried append after a crash is deduplicated. The applied delegation,
 * not this event, grants authority; an append failure is retried by nothing and loses only the
 * audit line, while the materialization receipt of the apply remains canonical.
 */
export function recordDelegationContinuation(
  storage: Pick<ProjectStorage, "events" | "manifest" | "writableEventSchemaVersion">,
  continuation: DelegationContinuation,
): boolean {
  if ((storage.writableEventSchemaVersion ?? 1) < EVENT_SCHEMA_VERSION) return false;
  const scope = hex(`lervo.convergence-continuity\0${continuation.repositoryIdentityHash}`, 24);
  const eventId = `evt_${hex(
    `knowledge.convergence.delegation.continued\0${canonicalJson({ planHash: continuation.planHash })}`,
    32,
  )}`;
  if (storage.events.get(eventId) !== null) return true;
  storage.events.append({
    eventId,
    projectId: storage.manifest.projectId,
    runId: `run_convergence_continuity_${scope}`,
    sessionId: `ses_convergence_continuity_${scope}`,
    occurredAt: continuation.occurredAt,
    actor: { kind: "system" },
    schemaVersion: EVENT_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    type: "knowledge.convergence.delegation.continued",
    payload: { ...continuation },
  });
  return true;
}
