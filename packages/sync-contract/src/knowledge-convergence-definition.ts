import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import { projectIdSchema } from "@lervo/schemas";

import { syncContentHash } from "./hash.js";

/**
 * ADR-0477 delegation-bound definition. A host whose active delegation verifies against its own
 * checkout publishes, through the Hub that holds its host record, the exact local definitions the
 * delegation binds: verification suites, repository role sources, and the asset disposition
 * manifest. A peer that seeds the same scope installs only content that reproduces the hash its
 * reviewed scope binds. The Hub stores definitions content-addressed and never interprets them.
 */
const HASH = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_ID = new RegExp(projectIdSchema.pattern, "u");
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

/** One definition's canonical JSON; a suite is at most 64 KiB and a role source 128 KiB. */
export const MAXIMUM_CONVERGENCE_DEFINITION_BYTES = 256 * 1024;
/** Definitions kept per repository identity; the least recently published is pruned first. */
export const MAXIMUM_CONVERGENCE_DEFINITIONS = 64;
/** A repository role travels with at most this many repository ancestors. */
export const MAXIMUM_CONVERGENCE_ROLE_SOURCES = 9;

export type KnowledgeConvergenceDefinitionKind =
  "verification_suite" | "repository_role" | "asset_disposition_manifest";

/**
 * `verification_suite`: the parsed suite; the binding is `verificationSuiteHash(suite)`, which is
 * the content hash. `repository_role`: the bound role's repository source and its repository
 * ancestors; the binding is the role contract hash, which only an importing host can recompute.
 * `asset_disposition_manifest`: the exact manifest text; the binding is the hash of its bytes.
 */
export type KnowledgeConvergenceDefinitionContent =
  | Record<string, unknown>
  | { roleId: string; sources: Record<string, unknown>[] }
  | { text: string };

export interface KnowledgeConvergenceDefinition {
  schemaVersion: 1;
  projectId: string;
  repositoryIdentityHash: string;
  kind: KnowledgeConvergenceDefinitionKind;
  /** The hash a delegation scope binds for this definition. */
  bindingHash: string;
  /** `syncContentHash(content)`: the Hub's content address. */
  contentHash: string;
  content: KnowledgeConvergenceDefinitionContent;
  publishedAt: string;
  sourceHostHash: string;
}

export interface KnowledgeConvergenceDefinitionSummary {
  kind: KnowledgeConvergenceDefinitionKind;
  bindingHash: string;
  contentHash: string;
  publishedAt: string;
}

export type KnowledgeConvergenceDefinitionPublishStatus = "created" | "refreshed";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

/** The hash an asset disposition manifest binding names: the exact UTF-8 bytes of its text. */
export function knowledgeConvergenceTextHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function validContent(kind: unknown, bindingHash: string, content: unknown): boolean {
  if (!record(content)) return false;
  if (kind === "verification_suite")
    return content.suiteId !== undefined && syncContentHash(content) === bindingHash;
  if (kind === "asset_disposition_manifest")
    return (
      exactKeys(content, ["text"]) &&
      typeof content.text === "string" &&
      knowledgeConvergenceTextHash(content.text) === bindingHash
    );
  if (kind === "repository_role")
    return (
      exactKeys(content, ["roleId", "sources"]) &&
      typeof content.roleId === "string" &&
      IDENTIFIER.test(content.roleId) &&
      Array.isArray(content.sources) &&
      content.sources.length >= 1 &&
      content.sources.length <= MAXIMUM_CONVERGENCE_ROLE_SOURCES &&
      content.sources.every((source) => record(source) && typeof source.roleId === "string") &&
      content.sources.some((source) => (source as { roleId: string }).roleId === content.roleId)
    );
  return false;
}

/**
 * Structural and content-address validation. Suite and manifest content must also reproduce the
 * binding; a role's contract hash is recomputed by the importing host before anything is written.
 */
export function isKnowledgeConvergenceDefinition(
  value: unknown,
): value is KnowledgeConvergenceDefinition {
  if (
    !record(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "projectId",
      "repositoryIdentityHash",
      "kind",
      "bindingHash",
      "contentHash",
      "content",
      "publishedAt",
      "sourceHostHash",
    ])
  )
    return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.projectId === "string" &&
    PROJECT_ID.test(value.projectId) &&
    hash(value.repositoryIdentityHash) &&
    hash(value.bindingHash) &&
    hash(value.contentHash) &&
    hash(value.sourceHostHash) &&
    timestamp(value.publishedAt) &&
    validContent(value.kind, value.bindingHash, value.content) &&
    syncContentHash(value.content) === value.contentHash &&
    Buffer.byteLength(canonicalJson(value)) <= MAXIMUM_CONVERGENCE_DEFINITION_BYTES
  );
}

export function isKnowledgeConvergenceDefinitionSummary(
  value: unknown,
): value is KnowledgeConvergenceDefinitionSummary {
  return (
    record(value) &&
    exactKeys(value, ["kind", "bindingHash", "contentHash", "publishedAt"]) &&
    ["verification_suite", "repository_role", "asset_disposition_manifest"].includes(
      String(value.kind),
    ) &&
    hash(value.bindingHash) &&
    hash(value.contentHash) &&
    timestamp(value.publishedAt)
  );
}

export function knowledgeConvergenceDefinitionSummary(
  definition: KnowledgeConvergenceDefinition,
): KnowledgeConvergenceDefinitionSummary {
  return {
    kind: definition.kind,
    bindingHash: definition.bindingHash,
    contentHash: definition.contentHash,
    publishedAt: definition.publishedAt,
  };
}

/**
 * Builds a definition with its content address. Callers pass content they verified against the
 * binding; validation still refuses anything that does not hold.
 */
export function createKnowledgeConvergenceDefinition(input: {
  projectId: string;
  repositoryIdentityHash: string;
  kind: KnowledgeConvergenceDefinitionKind;
  bindingHash: string;
  content: KnowledgeConvergenceDefinitionContent;
  publishedAt: string;
  sourceHostHash: string;
}): KnowledgeConvergenceDefinition | null {
  const definition: KnowledgeConvergenceDefinition = {
    schemaVersion: 1,
    projectId: input.projectId,
    repositoryIdentityHash: input.repositoryIdentityHash,
    kind: input.kind,
    bindingHash: input.bindingHash,
    contentHash: syncContentHash(input.content),
    content: structuredClone(input.content),
    publishedAt: input.publishedAt,
    sourceHostHash: input.sourceHostHash,
  };
  return isKnowledgeConvergenceDefinition(definition) ? definition : null;
}
