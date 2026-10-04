import type { ArtifactStore, OutboxDelivery } from "@lervo/storage-contract";

import { sha256 } from "./integrity.js";
import type { KnowledgeIntakeDisposition } from "./knowledge-intake-policy.js";
import { MAXIMUM_REPOSITORY_CHANGE_PUBLISHED_PATHS } from "./repository-change-source.js";
import { TerminalOutcome } from "./repository-knowledge-worker-contract.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
/** Above the published bound the manifest alone names the paths; sub-jobs review them in order. */
const MAXIMUM_MANIFEST_PATHS = 20_000;

export interface RepositoryKnowledgeSourceManifestEntry {
  path: string;
  before: string | null;
  after: string | null;
  beforeCommit?: string | null;
  /** Schema version 4 only; older manifests are classified by the intake policy at review. */
  disposition?: KnowledgeIntakeDisposition;
}

export interface RepositoryKnowledgeSourceManifest {
  paths: RepositoryKnowledgeSourceManifestEntry[];
}

function invalid(): never {
  throw new TerminalOutcome("attention_required", "knowledge_job_source_invalid");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function safeRepositoryPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.includes(":") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function expectedManifestKeys(schemaVersion: number, projectId: unknown): string {
  return [
    ...(schemaVersion === 3 || (schemaVersion === 4 && projectId !== undefined)
      ? ["projectId"]
      : []),
    "schemaVersion",
    "kind",
    "sourceKind",
    "sourceEventId",
    "repositoryRevisionBefore",
    "repositoryRevisionAfter",
    "paths",
  ]
    .sort()
    .join();
}

function expectedEntryKeys(schemaVersion: number): string {
  return [
    "path",
    "before",
    "after",
    ...(schemaVersion === 1 ? [] : ["beforeCommit"]),
    ...(schemaVersion === 4 ? ["disposition"] : []),
  ]
    .sort()
    .join();
}

function validEntry(entry: unknown, schemaVersion: number, preceding: string): boolean {
  return (
    record(entry) &&
    safeRepositoryPath(entry.path) &&
    entry.path > preceding &&
    [entry.before, entry.after].every(
      (hash) => hash === null || (typeof hash === "string" && HASH.test(hash)),
    ) &&
    entry.before !== entry.after &&
    Object.keys(entry).sort().join() === expectedEntryKeys(schemaVersion) &&
    (schemaVersion === 1 ||
      entry.beforeCommit === null ||
      (typeof entry.beforeCommit === "string" && COMMIT.test(entry.beforeCommit))) &&
    (schemaVersion !== 4 || entry.disposition === "reviewable" || entry.disposition === "generated")
  );
}

/** The manifest's private bytes must agree with every published coordinate before any path is read. */
export async function readManifest(
  artifacts: ArtifactStore,
  delivery: OutboxDelivery,
): Promise<RepositoryKnowledgeSourceManifest> {
  const payload = delivery.event.payload as Record<string, unknown>;
  const reference = payload.sourceManifest;
  if (
    !record(reference) ||
    typeof reference.contentHash !== "string" ||
    !HASH.test(reference.contentHash) ||
    !Number.isInteger(reference.byteCount) ||
    (reference.byteCount as number) < 1 ||
    (reference.byteCount as number) > 1_048_576
  )
    invalid();
  const uri = `lervo-cas://sha256/${reference.contentHash.slice(7)}`;
  if (!(await artifacts.has(uri)))
    throw new TerminalOutcome("attention_required", "knowledge_job_source_unavailable");
  const bytes = await artifacts.get(uri);
  if (bytes.byteLength !== reference.byteCount || sha256(bytes) !== reference.contentHash)
    invalid();
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
  if (
    !record(value) ||
    ![1, 2, 3, 4].includes(value.schemaVersion as number) ||
    (value.projectId !== undefined && value.projectId !== delivery.event.projectId) ||
    value.kind !== "repository.change.source_manifest" ||
    value.sourceKind !== payload.sourceKind ||
    value.sourceEventId !== payload.sourceEventId ||
    value.repositoryRevisionBefore !== payload.repositoryRevisionBefore ||
    value.repositoryRevisionAfter !== payload.repositoryRevisionAfter ||
    !Array.isArray(value.paths) ||
    value.paths.length !== payload.changedPathCount ||
    value.paths.length === 0 ||
    value.paths.length > MAXIMUM_MANIFEST_PATHS ||
    Object.keys(value).sort().join() !==
      expectedManifestKeys(value.schemaVersion as number, value.projectId)
  )
    invalid();
  let preceding = "";
  const paths: RepositoryKnowledgeSourceManifestEntry[] = [];
  for (const entry of value.paths) {
    if (!validEntry(entry, value.schemaVersion as number, preceding)) invalid();
    const valid = entry as RepositoryKnowledgeSourceManifestEntry;
    preceding = valid.path;
    paths.push(valid);
  }
  const published =
    paths.length > MAXIMUM_REPOSITORY_CHANGE_PUBLISHED_PATHS ? [] : paths.map((item) => item.path);
  if (JSON.stringify(published) !== JSON.stringify(payload.changedPaths)) invalid();
  return { paths };
}
