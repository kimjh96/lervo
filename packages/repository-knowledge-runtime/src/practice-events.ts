import type { EventDraftV8 } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

export const PRACTICE_EVENT_SCHEMA_VERSION = 8;

/** The existing mixed-reader activation fence applies to every ADR-0543 event. */
export function appendPracticeEvent(
  storage: ProjectStorage,
  type: Extract<EventDraftV8["type"], "learning.observation.recorded" | `knowledge.skill${string}`>,
  payload: Record<string, unknown>,
): void {
  if ((storage.writableEventSchemaVersion ?? 1) < PRACTICE_EVENT_SCHEMA_VERSION) return;
  const id = sha256(canonicalJson([type, payload])).slice(7, 39);
  const eventId = `evt_${id}`;
  if (storage.events.get(eventId)) return;
  storage.events.append({
    eventId,
    projectId: storage.manifest.projectId,
    runId: `run_${id}`,
    sessionId: `ses_${id}`,
    type,
    schemaVersion: 8,
    occurredAt: String(payload.occurredAt),
    actor: { kind: "system" },
    policyVersion: sha256("lervo.practice-learning.v1"),
    payload,
  });
}
