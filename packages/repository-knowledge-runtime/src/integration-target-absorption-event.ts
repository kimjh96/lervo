import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import type { IntegrationTargetAbsorption } from "./integration-target-absorption.js";

const EVENT_SCHEMA_VERSION = 4;
const POLICY_VERSION = sha256("lervo.knowledge-integration-target-absorption.v1");

function hex(value: string, length: number): string {
  return sha256(value).slice("sha256:".length, "sha256:".length + length);
}

/**
 * Appends `knowledge.integration_target.absorbed` (ADR-0482). The previous tip is unique per
 * absorption, so a retried append is deduplicated. The backup ref keeps the exact old tip; a store
 * that cannot accept schema-4 events loses only this audit line.
 */
export function recordIntegrationTargetAbsorbed(
  storage: Pick<ProjectStorage, "events" | "manifest" | "writableEventSchemaVersion">,
  absorption: IntegrationTargetAbsorption & { pathSetHash: string },
  occurredAt: string,
): boolean {
  if ((storage.writableEventSchemaVersion ?? 1) < EVENT_SCHEMA_VERSION) return false;
  const scope = hex(`lervo.knowledge-integration-target\0${storage.manifest.projectId}`, 24);
  const eventId = `evt_${hex(
    `knowledge.integration_target.absorbed\0${canonicalJson([absorption.target, absorption.head])}`,
    32,
  )}`;
  if (storage.events.get(eventId) !== null) return true;
  storage.events.append({
    eventId,
    projectId: storage.manifest.projectId,
    runId: `run_knowledge_integration_${scope}`,
    sessionId: `ses_knowledge_integration_${scope}`,
    occurredAt,
    actor: { kind: "system" },
    schemaVersion: EVENT_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    type: "knowledge.integration_target.absorbed",
    payload: {
      previousTarget: absorption.target,
      mergeBase: absorption.base,
      newTarget: absorption.head,
      absorbedPathCount: absorption.absorbedPaths.length,
      droppedPathCount: absorption.droppedPaths.length,
      pathSetHash: absorption.pathSetHash,
      occurredAt,
    },
  });
  return true;
}
