import type { ProjectStorage } from "@lervo/project-storage";
import {
  applyDurableKnowledgeOperations,
  canonicalJson,
  sha256,
} from "@lervo/repository-knowledge";
import {
  calculateProjectIdentityHash,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

import {
  acceptFileDefinition,
  acceptRoles,
  type AcceptedDefinition,
  type ConvergenceDefinitionSource,
  type DefinitionFile,
} from "./delegation-definition-acceptance.js";
import {
  localDefinitionBytes,
  unreproducedDefinitionBindings,
  type ConvergenceDefinitionNeed,
} from "./delegation-definition-catalog.js";
import {
  recordDefinitionsInstalled,
  type InstalledDefinitionCoordinate,
} from "./delegation-definition-event.js";
import {
  lervoManagedDefinition,
  readInstalledDefinitions,
  recordInstalledDefinitions,
} from "./delegation-definition-ledger.js";
import type { ConvergenceDelegation } from "./delegation-contract.js";
import { bindConvergenceDelegationScope } from "./delegation-scope.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";

function failure(code: string): never {
  throw new KnowledgeConvergenceRuntimeError(code);
}

type PlannedWrite = DefinitionFile & { expectedCurrentHash: string | null };

/**
 * A write lands only on an absent path or on a file Lervo installed and nobody changed since.
 * Identical bytes need no write. Anything else is user-owned and stops the installation.
 */
async function plannedWrites(root: string, files: readonly DefinitionFile[]) {
  const ledger = await readInstalledDefinitions(root);
  const writes: PlannedWrite[] = [];
  for (const file of files) {
    let current: Buffer | null;
    try {
      current = localDefinitionBytes(root, file.path, file.maximumBytes);
    } catch {
      return failure("convergence_seed_definition_conflict");
    }
    if (current === null) {
      writes.push({ ...file, expectedCurrentHash: null });
      continue;
    }
    const currentHash = sha256(current);
    if (currentHash === sha256(file.content)) continue;
    if (!lervoManagedDefinition(ledger, file.path, currentHash))
      return failure("convergence_seed_definition_conflict");
    writes.push({ ...file, expectedCurrentHash: currentHash });
  }
  return writes;
}

/** No agent ID is ever minted from this; it only lets the scope pass the delegation contract. */
const PLACEHOLDER_AGENT_ID = `agt_${"0".repeat(24)}`;

/**
 * Installs what a peer's exchangeable scope binds, after the same contract and repository
 * identity checks seeding applies, so no definition of another repository is ever written.
 */
export async function installPeerScopeDefinitions(input: {
  storage: ProjectStorage;
  record: KnowledgeConvergenceHostRecord;
  expiresAt: string;
  source: ConvergenceDefinitionSource | null;
  observerHostHash: string | null;
  now: Date;
}): Promise<InstalledDefinitionCoordinate[]> {
  const delegation = input.record.delegation;
  if (delegation === null) return [];
  const scope = bindConvergenceDelegationScope({
    scope: delegation.scope,
    parentAgentId: PLACEHOLDER_AGENT_ID,
    expiresAt: input.expiresAt,
    reviewedAt: input.now.toISOString(),
  });
  if (
    scope.projectId !== input.storage.manifest.projectId ||
    scope.integrationTarget.repositoryIdentityHash !==
      calculateProjectIdentityHash(input.storage.manifest)
  )
    failure("convergence_seed_identity_mismatch");
  return installBoundDefinitions({
    storage: input.storage,
    scope,
    scopeHash: delegation.scopeHash,
    source: input.source,
    observerHostHash: input.observerHostHash,
    sourceHostHash: input.record.hostHash,
    now: input.now,
  });
}

/**
 * ADR-0477: before a host seeds a peer's scope, install the exact definitions that scope binds and
 * this checkout does not reproduce. Content is accepted only when it reproduces the reviewed
 * binding hash; nothing is executed. Writes go through one durable knowledge transaction as
 * Lervo-managed files, never over a user-owned file. Returns what was installed, possibly nothing.
 */
export async function installBoundDefinitions(input: {
  storage: ProjectStorage;
  scope: ConvergenceDelegation;
  scopeHash: string;
  source: ConvergenceDefinitionSource | null;
  observerHostHash: string | null;
  sourceHostHash: string | null;
  now: Date;
}): Promise<InstalledDefinitionCoordinate[]> {
  const root = input.storage.paths.repositoryRoot;
  const needs = await unreproducedDefinitionBindings(root, input.scope);
  if (needs.length === 0) return [];
  const fileNeeds = needs.filter(
    (need): need is Exclude<ConvergenceDefinitionNeed, { kind: "repository_role" }> =>
      need.kind !== "repository_role",
  );
  const roleNeeds = needs.filter(
    (need): need is Extract<ConvergenceDefinitionNeed, { kind: "repository_role" }> =>
      need.kind === "repository_role",
  );
  if (input.source === null)
    return fileNeeds.length === 0 ? [] : failure("convergence_seed_definition_unavailable");
  const accepted: AcceptedDefinition[] = [];
  for (const need of fileNeeds) accepted.push(await acceptFileDefinition(need, input.source));
  accepted.push(...(await acceptRoles(root, roleNeeds, input.source)));
  const files = new Map(
    accepted.flatMap((definition) => definition.files).map((file) => [file.path, file]),
  );
  const writes = await plannedWrites(root, [...files.values()]);
  if (writes.length === 0) return [];
  const replaced = new Set(
    writes.filter((write) => write.expectedCurrentHash !== null).map((write) => write.path),
  );
  const written = new Set(writes.map((write) => write.path));
  const coordinates: InstalledDefinitionCoordinate[] = accepted
    .filter((definition) => definition.files.some((file) => written.has(file.path)))
    .map((definition) => ({
      kind: definition.kind,
      bindingHash: definition.bindingHash,
      contentHash: definition.contentHash,
      action: definition.files.some((file) => replaced.has(file.path)) ? "replaced" : "created",
    }));
  const installedAt = input.now.toISOString();
  await recordInstalledDefinitions(
    root,
    writes.map((write) => ({ path: write.path, fileHash: sha256(write.content), installedAt })),
  );
  const receipt = {
    schemaVersion: 1 as const,
    scopeHash: input.scopeHash,
    definitions: coordinates,
    paths: writes.map((write) => write.path),
  };
  const planId = `kstruct_${sha256(canonicalJson(receipt)).slice(7, 31)}`;
  await applyDurableKnowledgeOperations({
    repositoryRoot: root,
    projectId: input.storage.manifest.projectId,
    planId,
    operations: writes.map((write) => ({
      path: write.path,
      action: write.expectedCurrentHash === null ? ("create" as const) : ("update" as const),
      ownership: "user" as const,
      mediaType: write.mediaType,
      content: write.content,
      desiredHash: sha256(write.content),
      ...(write.expectedCurrentHash === null
        ? {}
        : { expectedCurrentHash: write.expectedCurrentHash }),
    })),
    receipt,
    recordApplied: (applied) =>
      recordConvergenceMaterialization(input.storage, {
        operation: "convergence_delegation_definitions",
        planId,
        sourceSnapshotId: planId,
        policyHash: input.scopeHash,
        receipt: applied,
        created: writes.filter((write) => write.expectedCurrentHash === null).map((w) => w.path),
        updated: writes.filter((write) => write.expectedCurrentHash !== null).map((w) => w.path),
        deleted: [],
        validation: { schemaVersion: 1, scopeHash: input.scopeHash, definitions: coordinates },
      }),
  });
  recordDefinitionsInstalled(input.storage, {
    repositoryIdentityHash: calculateProjectIdentityHash(input.storage.manifest),
    scopeHash: input.scopeHash,
    observerHostHash: input.observerHostHash,
    sourceHostHash: input.sourceHostHash,
    definitions: coordinates,
    occurredAt: installedAt,
  });
  return coordinates;
}
