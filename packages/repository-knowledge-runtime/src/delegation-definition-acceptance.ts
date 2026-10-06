import { sha256 } from "@lervo/repository-knowledge";
import { previewRoleContracts, type ResolvedRoleContract } from "@lervo/roles";
import type { VerificationSuite } from "@lervo/schemas";
import type {
  KnowledgeConvergenceDefinition,
  KnowledgeConvergenceDefinitionKind,
} from "@lervo/sync-contract";
import { validateVerificationSuite, verificationSuiteHash } from "@lervo/verification";

import { CONVERGENCE_ASSET_DISPOSITIONS_PATH } from "./asset-disposition-manifest.js";
import {
  repositoryRolePath,
  roleContractMatches,
  verificationSuitePath,
  type ConvergenceDefinitionNeed,
} from "./delegation-definition-catalog.js";
import type { ConvergenceRoleBinding } from "./delegation-contract.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/**
 * ADR-0477 acceptance: which shared candidate, if any, reproduces a reviewed binding, and the
 * exact file it becomes. Read-only; installation decides ownership and writes.
 */

/** Where a seeding host finds shared definitions; the Hub adapter caches one listing. */
export interface ConvergenceDefinitionSource {
  /** Definitions whose binding hash equals `bindingHash`, newest first; unverified. */
  candidates(
    kind: KnowledgeConvergenceDefinitionKind,
    bindingHash: string,
  ): Promise<KnowledgeConvergenceDefinition[]>;
}

const MAXIMUM_SUITE_FILE_BYTES = 64 * 1024;
const MAXIMUM_ROLE_FILE_BYTES = 128 * 1024;
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;

export interface DefinitionFile {
  path: string;
  content: string;
  mediaType: "application/yaml" | "application/json";
  maximumBytes: number;
}

export interface AcceptedDefinition {
  kind: KnowledgeConvergenceDefinitionKind;
  bindingHash: string;
  contentHash: string;
  files: DefinitionFile[];
}

function failure(code: string): never {
  throw new KnowledgeConvergenceRuntimeError(code);
}

function suiteFile(suiteId: string, bindingHash: string, suite: unknown): DefinitionFile {
  return {
    path: verificationSuitePath(suiteId),
    content: [
      `# Lervo-managed verification suite (ADR-0477), installed because a reviewed convergence`,
      `# delegation binds ${bindingHash}. Editing it makes it yours; commit it through review.`,
      `${JSON.stringify(suite, null, 2)}\n`,
    ].join("\n"),
    mediaType: "application/yaml",
    maximumBytes: MAXIMUM_SUITE_FILE_BYTES,
  };
}

/** The suite content that reproduces the binding, rendered as the file the loader reads. */
function verifiedSuite(
  need: Extract<ConvergenceDefinitionNeed, { kind: "verification_suite" }>,
  candidate: KnowledgeConvergenceDefinition,
): DefinitionFile | null {
  const suite = candidate.content as unknown as VerificationSuite;
  try {
    validateVerificationSuite(suite);
  } catch {
    return null;
  }
  if (suite.suiteId !== need.suiteId || verificationSuiteHash(suite) !== need.bindingHash)
    return null;
  const file = suiteFile(need.suiteId, need.bindingHash, suite);
  return Buffer.byteLength(file.content) <= file.maximumBytes ? file : null;
}

function verifiedManifest(
  need: Extract<ConvergenceDefinitionNeed, { kind: "asset_disposition_manifest" }>,
  candidate: KnowledgeConvergenceDefinition,
): DefinitionFile | null {
  const text = (candidate.content as { text?: unknown }).text;
  if (typeof text !== "string" || sha256(text) !== need.bindingHash) return null;
  return Buffer.byteLength(text) <= MAXIMUM_MANIFEST_BYTES
    ? {
        path: CONVERGENCE_ASSET_DISPOSITIONS_PATH,
        content: text,
        mediaType: "application/json",
        maximumBytes: MAXIMUM_MANIFEST_BYTES,
      }
    : null;
}

async function resolvesBindings(
  root: string,
  overlay: ReadonlyMap<string, Record<string, unknown>>,
  bindings: readonly ConvergenceRoleBinding[],
): Promise<boolean> {
  let contracts: ResolvedRoleContract[];
  try {
    contracts = await previewRoleContracts(root, [...overlay.values()]);
  } catch {
    return false;
  }
  return bindings.every((binding) =>
    roleContractMatches(
      contracts.find((contract) => contract.roleId === binding.roleId),
      binding,
    ),
  );
}

/**
 * Repository role sources are accepted only when the registry, with them added, resolves every
 * accepted binding to its exact version, contract hash, and profile hash. A role nobody shared is
 * left to the seeding role check, which names it.
 */
export async function acceptRoles(
  root: string,
  needs: readonly Extract<ConvergenceDefinitionNeed, { kind: "repository_role" }>[],
  source: ConvergenceDefinitionSource,
): Promise<AcceptedDefinition[]> {
  let overlay = new Map<string, Record<string, unknown>>();
  const accepted: { need: (typeof needs)[number]; contentHash: string }[] = [];
  for (const need of needs) {
    for (const candidate of await source.candidates("repository_role", need.bindingHash)) {
      const sources = (candidate.content as { sources?: unknown }).sources;
      if (!Array.isArray(sources)) continue;
      const trial = new Map(overlay);
      for (const item of sources as Record<string, unknown>[]) trial.set(String(item.roleId), item);
      const bindings = [...accepted.map((entry) => entry.need.binding), need.binding];
      if (!(await resolvesBindings(root, trial, bindings))) continue;
      overlay = trial;
      accepted.push({ need, contentHash: candidate.contentHash });
      break;
    }
  }
  if (accepted.length === 0) return [];
  const files: DefinitionFile[] = [...overlay.entries()].map(([roleId, item]) => ({
    path: repositoryRolePath(roleId),
    content: `${JSON.stringify(item, null, 2)}\n`,
    mediaType: "application/json",
    maximumBytes: MAXIMUM_ROLE_FILE_BYTES,
  }));
  // Accepted roles share one resolved overlay; the installer writes each path once.
  return accepted.map((entry) => ({
    kind: "repository_role",
    bindingHash: entry.need.bindingHash,
    contentHash: entry.contentHash,
    files,
  }));
}

export async function acceptFileDefinition(
  need: Exclude<ConvergenceDefinitionNeed, { kind: "repository_role" }>,
  source: ConvergenceDefinitionSource,
): Promise<AcceptedDefinition> {
  for (const candidate of await source.candidates(need.kind, need.bindingHash)) {
    const file =
      need.kind === "verification_suite"
        ? verifiedSuite(need, candidate)
        : verifiedManifest(need, candidate);
    if (file !== null)
      return {
        kind: need.kind,
        bindingHash: need.bindingHash,
        contentHash: candidate.contentHash,
        files: [file],
      };
  }
  return failure("convergence_seed_definition_unavailable");
}
