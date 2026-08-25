import { randomUUID } from "node:crypto";

import type { WorkforceEvent } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";

export function recordWorkforceEvent(storage: ProjectStorage, event: WorkforceEvent): void {
  const identity = randomUUID().replaceAll("-", "");
  storage.events.append({
    eventId: `evt_${identity}`,
    projectId: storage.manifest.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type: event.type,
    occurredAt: event.occurredAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: sha256(JSON.stringify(event.payload)),
    payload: event.payload,
  });
}
