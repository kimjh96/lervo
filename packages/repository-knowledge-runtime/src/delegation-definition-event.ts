import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { KnowledgeConvergenceDefinitionKind } from "@lervo/sync-contract";

const EVENT_SCHEMA_VERSION = 4;
const POLICY_VERSION = sha256("lervo.knowledge-convergence-continuity.v1");

export interface InstalledDefinitionCoordinate {
  kind: KnowledgeConvergenceDefinitionKind;
  bindingHash: string;
  contentHash: string;
  action: "created" | "replaced";
}

export interface DefinitionsInstallation {
  repositoryIdentityHash: string;
  scopeHash: string;
  observerHostHash: string | null;
  sourceHostHash: string | null;
  definitions: InstalledDefinitionCoordinate[];
  occurredAt: string;
}

function hex(value: string, length: number): string {
  return sha256(value).slice("sha256:".length, "sha256:".length + length);
}

/**
 * Appends `knowledge.convergence.definitions.installed` (ADR-0477). The event ID derives from the
 * scope and the installed coordinates, so a retried append is deduplicated. The installed files and
 * the materialization receipt are canonical; an append failure loses only this audit line.
 */
export function recordDefinitionsInstalled(
  storage: Pick<ProjectStorage, "events" | "manifest" | "writableEventSchemaVersion">,
  installation: DefinitionsInstallation,
): boolean {
  if ((storage.writableEventSchemaVersion ?? 1) < EVENT_SCHEMA_VERSION) return false;
  const scope = hex(`lervo.convergence-continuity\0${installation.repositoryIdentityHash}`, 24);
  const eventId = `evt_${hex(
    `knowledge.convergence.definitions.installed\0${canonicalJson({
      scopeHash: installation.scopeHash,
      definitions: installation.definitions,
    })}`,
    32,
  )}`;
  if (storage.events.get(eventId) !== null) return true;
  storage.events.append({
    eventId,
    projectId: storage.manifest.projectId,
    runId: `run_convergence_continuity_${scope}`,
    sessionId: `ses_convergence_continuity_${scope}`,
    occurredAt: installation.occurredAt,
    actor: { kind: "system" },
    schemaVersion: EVENT_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    type: "knowledge.convergence.definitions.installed",
    payload: {
      ...installation,
      definitions: installation.definitions.map((item) => ({ ...item })),
    },
  });
  return true;
}
