import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

import { sha256 } from "./integrity.js";
import { listKnowledgeArtifactPaths, shardedKnowledgeArtifactPath } from "./artifact-paths.js";

export interface StoredConcept {
  schemaVersion: 1;
  conceptId: string;
  title: string;
  path: string;
  ownership: "user" | "lervo_generated";
  publicationStatus?: "draft" | "stable" | "deprecated";
  publicationLanguage?: string;
  freshness?: "current" | "stale" | "unknown";
  sourceUnitVersionIds: string[];
  assurance?: "unreviewed" | "human_reviewed";
}

export interface StoredClaim {
  schemaVersion: 1;
  claimId: string;
  conceptId: string;
  statement: string;
  statementDigest: string;
  evidenceUnitVersionIds: string[];
  evidenceUnitIds?: string[];
  assurance: "human_reviewed";
  freshness: "current";
  reviewId: string;
}

export interface StoredRelation {
  schemaVersion: 1;
  relationId: string;
  from: { kind: "concept"; id: string };
  to: { kind: "concept"; id: string };
  type: "depends_on" | "constrains" | "related_to" | "supersedes" | "contradicts";
  evidenceUnitVersionIds: string[];
  evidenceUnitIds?: string[];
  assurance: "human_reviewed";
  freshness: "current";
  reviewId: string;
}

export interface StoredValue<T> { file: string; value: T | null; error?: string }

export async function loadStoredConcepts(root: string): Promise<Array<StoredValue<StoredConcept>>> {
  const files = await listKnowledgeArtifactPaths({ root, directory: ".lervo/knowledge/concepts", extension: "yaml", maximumFiles: 20_000 });
  const results: Array<StoredValue<StoredConcept>> = [];
  const ids = new Set<string>();
  for (const file of files) {
    const name = file.split("/").at(-1)!;
    try {
      const value = parse(await readFile(resolve(root, file), "utf8")) as Partial<StoredConcept>;
      if (
        value.schemaVersion !== 1 || typeof value.conceptId !== "string" ||
        `${value.conceptId}.yaml` !== name || typeof value.title !== "string" ||
        typeof value.path !== "string" || (value.ownership !== "user" && value.ownership !== "lervo_generated") ||
        (value.publicationLanguage !== undefined && value.publicationLanguage !== "en") ||
        (value.publicationStatus !== undefined && !["draft", "stable", "deprecated"].includes(value.publicationStatus)) ||
        (value.freshness !== undefined && !["current", "stale", "unknown"].includes(value.freshness)) ||
        (value.assurance !== undefined && value.assurance !== "unreviewed" && value.assurance !== "human_reviewed") ||
        !Array.isArray(value.sourceUnitVersionIds) || !value.sourceUnitVersionIds.every((item) => typeof item === "string") ||
        (file.includes("/concepts/") && file.split("/").length > 4 && file !== shardedKnowledgeArtifactPath(".lervo/knowledge/concepts", value.conceptId, "yaml")) ||
        ids.has(value.conceptId)
      ) throw new Error("The concept sidecar contract is invalid.");
      ids.add(value.conceptId);
      results.push({ file, value: value as StoredConcept });
    } catch (error) { results.push({ file, value: null, error: error instanceof Error ? error.message : String(error) }); }
  }
  return results;
}

export async function loadStoredClaims(root: string): Promise<Array<StoredValue<StoredClaim>>> {
  const files = await listKnowledgeArtifactPaths({ root, directory: ".lervo/knowledge/claims", extension: "yaml", maximumFiles: 20_000 });
  const results: Array<StoredValue<StoredClaim>> = [];
  const ids = new Set<string>();
  for (const file of files) {
    const name = file.split("/").at(-1)!;
    try {
      const value = parse(await readFile(resolve(root, file), "utf8")) as Partial<StoredClaim>;
      if (
        value.schemaVersion !== 1 || typeof value.claimId !== "string" || `${value.claimId}.yaml` !== name ||
        typeof value.conceptId !== "string" || typeof value.statement !== "string" ||
        typeof value.statementDigest !== "string" || sha256(value.statement) !== value.statementDigest ||
        !Array.isArray(value.evidenceUnitVersionIds) || value.evidenceUnitVersionIds.length < 1 ||
        !value.evidenceUnitVersionIds.every((id) => typeof id === "string") || value.assurance !== "human_reviewed" ||
        (value.evidenceUnitIds !== undefined && (!Array.isArray(value.evidenceUnitIds) || value.evidenceUnitIds.length !== value.evidenceUnitVersionIds.length || !value.evidenceUnitIds.every((id) => typeof id === "string"))) ||
        value.freshness !== "current" || typeof value.reviewId !== "string" ||
        (file.split("/").length > 4 && file !== shardedKnowledgeArtifactPath(".lervo/knowledge/claims", value.claimId, "yaml")) ||
        ids.has(value.claimId)
      ) throw new Error("The claim sidecar contract is invalid.");
      ids.add(value.claimId);
      results.push({ file, value: value as StoredClaim });
    } catch (error) { results.push({ file, value: null, error: error instanceof Error ? error.message : String(error) }); }
  }
  return results;
}

export async function loadStoredRelations(root: string): Promise<Array<StoredValue<StoredRelation>>> {
  const files = await listKnowledgeArtifactPaths({ root, directory: ".lervo/knowledge/relations", extension: "yaml", maximumFiles: 20_000 });
  const results: Array<StoredValue<StoredRelation>> = [];
  const ids = new Set<string>();
  for (const file of files) {
    const name = file.split("/").at(-1)!;
    try {
      const value = parse(await readFile(resolve(root, file), "utf8")) as Partial<StoredRelation>;
      if (
        value.schemaVersion !== 1 || typeof value.relationId !== "string" || `${value.relationId}.yaml` !== name ||
        value.from?.kind !== "concept" || typeof value.from.id !== "string" || value.to?.kind !== "concept" || typeof value.to.id !== "string" ||
        !["depends_on", "constrains", "related_to", "supersedes", "contradicts"].includes(value.type ?? "") ||
        !Array.isArray(value.evidenceUnitVersionIds) || value.evidenceUnitVersionIds.length < 1 ||
        !value.evidenceUnitVersionIds.every((id) => typeof id === "string") || value.assurance !== "human_reviewed" ||
        (value.evidenceUnitIds !== undefined && (!Array.isArray(value.evidenceUnitIds) || value.evidenceUnitIds.length !== value.evidenceUnitVersionIds.length || !value.evidenceUnitIds.every((id) => typeof id === "string"))) ||
        value.freshness !== "current" || typeof value.reviewId !== "string" ||
        (file.split("/").length > 4 && file !== shardedKnowledgeArtifactPath(".lervo/knowledge/relations", value.relationId, "yaml")) ||
        ids.has(value.relationId)
      ) throw new Error("The relation sidecar contract is invalid.");
      ids.add(value.relationId);
      results.push({ file, value: value as StoredRelation });
    } catch (error) { results.push({ file, value: null, error: error instanceof Error ? error.message : String(error) }); }
  }
  return results;
}
