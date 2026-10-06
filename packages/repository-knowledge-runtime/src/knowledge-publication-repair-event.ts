import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

const EVENT_SCHEMA_VERSION = 4;
const POLICY_VERSION = sha256("lervo.knowledge-publication-repair.v1");

export interface KnowledgePublicationRepair {
  repairCommit: string;
  repairedCommits: string[];
  toolGeneratedPathCount: number;
  outsideScopePathCount: number;
  normalizationPathCount: number;
  pathSetHash: string;
  hostHash: string | null;
  occurredAt: string;
}

function hex(value: string, length: number): string {
  return sha256(value).slice("sha256:".length, "sha256:".length + length);
}

/**
 * Appends `knowledge.publication.repaired` (ADR-0473). The repair commit is unique, so a retried
 * append is deduplicated. The commit and its `Lervo-Publication-Repair` trailers stay the
 * canonical record; a store that cannot accept schema-4 events loses only this audit line.
 */
export function recordKnowledgePublicationRepair(
  storage: Pick<ProjectStorage, "events" | "manifest" | "writableEventSchemaVersion">,
  repair: KnowledgePublicationRepair,
): boolean {
  if ((storage.writableEventSchemaVersion ?? 1) < EVENT_SCHEMA_VERSION) return false;
  const scope = hex(`lervo.knowledge-publication-repair\0${storage.manifest.projectId}`, 24);
  const eventId = `evt_${hex(
    `knowledge.publication.repaired\0${canonicalJson({ repairCommit: repair.repairCommit })}`,
    32,
  )}`;
  if (storage.events.get(eventId) !== null) return true;
  storage.events.append({
    eventId,
    projectId: storage.manifest.projectId,
    runId: `run_knowledge_publication_${scope}`,
    sessionId: `ses_knowledge_publication_${scope}`,
    occurredAt: repair.occurredAt,
    actor: { kind: "system" },
    schemaVersion: EVENT_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    type: "knowledge.publication.repaired",
    payload: { ...repair },
  });
  return true;
}
