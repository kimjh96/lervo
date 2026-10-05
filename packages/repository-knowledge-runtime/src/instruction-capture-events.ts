import { sha256 } from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";

/** Capture events exist only in event schema 4, like the other ADR-0452 platform events. */
export const INSTRUCTION_CAPTURE_EVENT_SCHEMA_VERSION = 4;
const POLICY_VERSION = sha256("lervo.instruction-capture.v1");

function hex(value: string, length: number): string {
  return sha256(value).slice("sha256:".length, "sha256:".length + length);
}

/**
 * Appends one capture event. The identity binds the type and correlation, so a cycle retried after
 * a crash reuses the stored event instead of recording the capture twice.
 */
export function appendInstructionCaptureEvent(input: {
  storage: Pick<ProjectStorage, "events" | "manifest">;
  type:
    | "knowledge.instruction_candidate.captured"
    | "conversation.knowledge_candidate.recorded"
    | "knowledge.instruction_capture.cycle.completed"
    | "knowledge.instruction_candidate.exchanged";
  correlationId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}): void {
  const identity = hex(`${input.type}\0${input.correlationId}`, 32);
  if (input.storage.events.get(`evt_${identity}`) !== null) return;
  const scope = hex(`lervo.instruction-capture\0${input.correlationId}`, 24);
  input.storage.events.append({
    eventId: `evt_${identity}`,
    projectId: input.storage.manifest.projectId,
    runId: `run_capture_${scope}`,
    sessionId: `ses_capture_${scope}`,
    occurredAt: input.occurredAt,
    actor: { kind: "system" },
    schemaVersion: INSTRUCTION_CAPTURE_EVENT_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    type: input.type,
    payload: input.payload,
  });
}
