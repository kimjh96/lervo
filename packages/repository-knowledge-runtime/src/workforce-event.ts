import { randomUUID } from "node:crypto";
import type { WorkforceEvent } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

export function recordConvergenceWorkforceEvent(
  storage: ProjectStorage,
  event: WorkforceEvent,
): void {
  const identity = randomUUID().replaceAll("-", "");
  storage.events.append({
    eventId: `evt_${identity}`,
    projectId: storage.manifest.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type: event.type,
    occurredAt: event.occurredAt,
    actor: { kind: "system" },
    schemaVersion: 4,
    policyVersion: sha256(canonicalJson(event.payload)),
    payload: event.payload,
  });
}
