import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import {
  listRoleContracts,
  parseRepositoryRoleSource,
  resolveRoleContract,
  roleProfileHash,
  type ResolvedRoleContract,
} from "@lervo/roles";
import type { KnowledgeConvergenceDefinitionKind } from "@lervo/sync-contract";
import { loadVerificationSuite, verificationSuiteHash } from "@lervo/verification";

import { CONVERGENCE_ASSET_DISPOSITIONS_PATH } from "./asset-disposition-manifest.js";
import type { ConvergenceDelegation, ConvergenceRoleBinding } from "./delegation-contract.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";

/**
 * ADR-0477: which local definitions a delegation binds, read-only. A delegation names verification
 * suites, role contracts, and an optional asset disposition manifest only by hash; this module maps
 * each binding to the local file that must reproduce it and reports which bindings this checkout
 * does not reproduce. It never writes.
 */
const MAXIMUM_ROLE_SOURCE_BYTES = 128 * 1024;
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;

export type ConvergenceBoundDefinitionContent =
  | Record<string, unknown>
  | { roleId: string; sources: Record<string, unknown>[] }
  | { text: string };

/** A binding this checkout does not reproduce. */
export type ConvergenceDefinitionNeed =
  | { kind: "verification_suite"; bindingHash: string; suiteId: string }
  | { kind: "repository_role"; bindingHash: string; binding: ConvergenceRoleBinding }
  | { kind: "asset_disposition_manifest"; bindingHash: string };

/** A local definition that reproduces its binding exactly. */
export interface ConvergenceBoundDefinition {
  kind: KnowledgeConvergenceDefinitionKind;
  bindingHash: string;
  content: ConvergenceBoundDefinitionContent;
}

export function verificationSuitePath(suiteId: string): string {
  return `.lervo/verifications/${suiteId}.yaml`;
}

export function repositoryRolePath(roleId: string): string {
  return `.lervo/roles/${roleId}.json`;
}

/** Null for an absent file; any other unreadable state throws. */
export function localDefinitionBytes(root: string, path: string, maximumBytes: number) {
  try {
    return ordinaryConvergenceSourceBytes(root, path, maximumBytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function localSuiteHash(root: string, suiteId: string): Promise<string | null> {
  return loadVerificationSuite(root, suiteId).then(verificationSuiteHash, () => null);
}

export function roleContractMatches(
  contract: ResolvedRoleContract | undefined,
  binding: ConvergenceRoleBinding,
): boolean {
  return (
    contract !== undefined &&
    contract.version === binding.version &&
    contract.contractHash === binding.contractHash &&
    roleProfileHash(contract.definition.profile) === binding.profileHash
  );
}

function manifestHash(root: string): string | null {
  try {
    const bytes = localDefinitionBytes(
      root,
      CONVERGENCE_ASSET_DISPOSITIONS_PATH,
      MAXIMUM_MANIFEST_BYTES,
    );
    return bytes === null ? null : sha256(bytes);
  } catch {
    return null;
  }
}

function distinctRoles(delegation: Pick<ConvergenceDelegation, "roles">): ConvergenceRoleBinding[] {
  const seen = new Map<string, ConvergenceRoleBinding>();
  for (const binding of Object.values(delegation.roles)) seen.set(canonicalJson(binding), binding);
  return [...seen.values()];
}

/** Every binding of `scope` this checkout does not reproduce, in suite, role, manifest order. */
export async function unreproducedDefinitionBindings(
  root: string,
  scope: Pick<ConvergenceDelegation, "verification" | "roles" | "assetDispositionManifestHash">,
): Promise<ConvergenceDefinitionNeed[]> {
  const needs: ConvergenceDefinitionNeed[] = [];
  for (const suite of scope.verification)
    if ((await localSuiteHash(root, suite.suiteId)) !== suite.suiteHash)
      needs.push({
        kind: "verification_suite",
        bindingHash: suite.suiteHash,
        suiteId: suite.suiteId,
      });
  for (const binding of distinctRoles(scope)) {
    const contract = await resolveRoleContract(root, binding.roleId).catch(() => undefined);
    if (!roleContractMatches(contract, binding))
      needs.push({ kind: "repository_role", bindingHash: binding.contractHash, binding });
  }
  const bound = scope.assetDispositionManifestHash;
  if (bound !== undefined && manifestHash(root) !== bound)
    needs.push({ kind: "asset_disposition_manifest", bindingHash: bound });
  return needs;
}

function roleSource(root: string, roleId: string): Record<string, unknown> {
  const bytes = localDefinitionBytes(root, repositoryRolePath(roleId), MAXIMUM_ROLE_SOURCE_BYTES);
  if (bytes === null) throw new Error("The repository role source disappeared.");
  const value: unknown = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  return parseRepositoryRoleSource(value, roleId) as unknown as Record<string, unknown>;
}

/** A repository role's own source and the sources of its repository ancestors, root first. */
function repositoryLineage(
  root: string,
  roleId: string,
  contracts: ReadonlyMap<string, ResolvedRoleContract>,
): Record<string, unknown>[] {
  const ordered: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    const contract = contracts.get(id);
    if (contract?.sourceKind !== "repository" || visited.has(id)) return;
    visited.add(id);
    for (const base of contract.extends) visit(base.roleId);
    ordered.push(roleSource(root, id));
  };
  visit(roleId);
  return ordered;
}

/**
 * The bound definitions this checkout holds byte-for-byte as reviewed, ready to share. Built-in
 * roles ship with Lervo and are never shared; a binding this checkout does not reproduce is
 * omitted, so nothing unreviewed leaves the host.
 */
export async function reproducedBoundDefinitions(
  root: string,
  delegation: ConvergenceDelegation,
): Promise<ConvergenceBoundDefinition[]> {
  const definitions: ConvergenceBoundDefinition[] = [];
  for (const suite of delegation.verification) {
    const loaded = await loadVerificationSuite(root, suite.suiteId).catch(() => null);
    if (loaded !== null && verificationSuiteHash(loaded) === suite.suiteHash)
      definitions.push({
        kind: "verification_suite",
        bindingHash: suite.suiteHash,
        content: loaded as unknown as Record<string, unknown>,
      });
  }
  const contracts = new Map(
    (await listRoleContracts(root).catch(() => [])).map((contract) => [contract.roleId, contract]),
  );
  for (const binding of distinctRoles(delegation)) {
    const contract = contracts.get(binding.roleId);
    if (contract?.sourceKind !== "repository" || !roleContractMatches(contract, binding)) continue;
    try {
      definitions.push({
        kind: "repository_role",
        bindingHash: binding.contractHash,
        content: {
          roleId: binding.roleId,
          sources: repositoryLineage(root, binding.roleId, contracts),
        },
      });
    } catch {
      // A source that changed after resolution is shared on the next reconciliation.
    }
  }
  const bound = delegation.assetDispositionManifestHash;
  if (bound !== undefined) {
    try {
      const bytes = localDefinitionBytes(
        root,
        CONVERGENCE_ASSET_DISPOSITIONS_PATH,
        MAXIMUM_MANIFEST_BYTES,
      );
      if (bytes !== null && sha256(bytes) === bound)
        definitions.push({
          kind: "asset_disposition_manifest",
          bindingHash: bound,
          content: {
            text: new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes),
          },
        });
    } catch {
      // Unreadable or non-UTF-8 manifest bytes cannot be shared exactly.
    }
  }
  return definitions;
}
