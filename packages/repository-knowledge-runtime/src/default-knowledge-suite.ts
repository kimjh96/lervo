// ADR-0655: a repository without a verification suite still gets background knowledge
// maintenance. Seeding binds the repository's own default suite; when there is none, Lervo
// installs one that checks only what the convergence worker changes, the knowledge, with
// `lervo knowledge lint`, which needs no project toolchain.
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { applyDurableKnowledgeOperations, sha256 } from "@lervo/repository-knowledge";

import { localDefinitionBytes } from "./delegation-definition-catalog.js";
import { recordInstalledDefinitions } from "./delegation-definition-ledger.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";

/** The default suite's ID: outside `repository.default*`, so an owner's suite always wins. */
export const DEFAULT_KNOWLEDGE_SUITE_ID = "lervo.default.knowledge";
export const DEFAULT_KNOWLEDGE_SUITE_PATH = `.lervo/verifications/${DEFAULT_KNOWLEDGE_SUITE_ID}.yaml`;

/** Fixed bytes, so every host installs the same suite and binds the same hash. */
export const DEFAULT_KNOWLEDGE_SUITE_CONTENT = `schemaVersion: 1
suiteId: ${DEFAULT_KNOWLEDGE_SUITE_ID}
stopOnFailure: true
commands:
  - commandId: knowledge-lint
    executable: lervo
    arguments:
      - knowledge
      - lint
    cwd: .
    timeoutMs: 300000
    maxOutputBytes: 1048576
    environmentVariableNames: []
`;

const VERSIONED_DEFAULT_SUITE = /^repository\.default\.v([1-9][0-9]*)$/u;
const MAXIMUM_SUITE_BYTES = 256 * 1024;

/** The suite IDs in `.lervo/verifications`, or none when the directory does not exist. */
export async function repositorySuiteIds(root: string): Promise<string[]> {
  try {
    return (await readdir(resolve(root, ".lervo/verifications"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name.slice(0, -".yaml".length));
  } catch {
    return [];
  }
}

/**
 * The suite seeding binds: the latest `repository.default.vN`, else `repository.default`, else
 * exactly one other suite that is neither a pilot nor Lervo's default, else Lervo's default.
 * Null when none of these exists.
 */
export function selectRepositoryDefaultSuite(names: readonly string[]): string | null {
  const versioned = names
    .map((name) => ({ name, version: VERSIONED_DEFAULT_SUITE.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; version: string } => entry.version !== undefined)
    .sort(
      (left, right) =>
        right.version.length - left.version.length || right.version.localeCompare(left.version),
    );
  if (versioned[0] !== undefined) return versioned[0].name;
  if (names.includes("repository.default")) return "repository.default";
  const owners = names.filter(
    (name) => !name.startsWith("lervo.pilot.") && name !== DEFAULT_KNOWLEDGE_SUITE_ID,
  );
  if (owners.length === 1) return owners[0]!;
  if (owners.length === 0 && names.includes(DEFAULT_KNOWLEDGE_SUITE_ID))
    return DEFAULT_KNOWLEDGE_SUITE_ID;
  return null;
}

/**
 * Installs the default suite when the repository has no suite seeding can bind, or when a peer's
 * scope binds the default and this checkout lacks it. The file is created only where no file
 * exists, recorded in the installed-definitions ledger as Lervo-managed, written in one durable
 * knowledge transaction, and announced by a materialization event. It is not committed, like every
 * installed definition (ADR-0477); an owner who commits or replaces it takes it over. Returns
 * whether it installed the suite.
 */
export async function ensureDefaultKnowledgeSuite(input: {
  storage: ProjectStorage;
  now: Date;
  /** Install even though the repository has its own suite, because a peer's scope binds the default. */
  boundByPeer?: boolean;
}): Promise<boolean> {
  const root = input.storage.paths.repositoryRoot;
  const names = await repositorySuiteIds(root);
  if (names.includes(DEFAULT_KNOWLEDGE_SUITE_ID)) return false;
  if (input.boundByPeer !== true && selectRepositoryDefaultSuite(names) !== null) return false;
  if (localDefinitionBytes(root, DEFAULT_KNOWLEDGE_SUITE_PATH, MAXIMUM_SUITE_BYTES) !== null)
    return false;
  const content = DEFAULT_KNOWLEDGE_SUITE_CONTENT;
  const contentHash = sha256(content);
  const installedAt = input.now.toISOString();
  await recordInstalledDefinitions(root, [
    { path: DEFAULT_KNOWLEDGE_SUITE_PATH, fileHash: contentHash, installedAt },
  ]);
  const planId = `kstruct_${contentHash.slice(7, 31)}`;
  await applyDurableKnowledgeOperations({
    repositoryRoot: root,
    projectId: input.storage.manifest.projectId,
    planId,
    operations: [
      {
        path: DEFAULT_KNOWLEDGE_SUITE_PATH,
        action: "create",
        ownership: "user",
        mediaType: "application/yaml",
        content,
        desiredHash: contentHash,
      },
    ],
    receipt: { schemaVersion: 1, suiteId: DEFAULT_KNOWLEDGE_SUITE_ID, contentHash },
    recordApplied: (applied) =>
      recordConvergenceMaterialization(input.storage, {
        operation: "convergence_default_verification_suite",
        planId,
        sourceSnapshotId: planId,
        policyHash: contentHash,
        receipt: applied,
        created: [DEFAULT_KNOWLEDGE_SUITE_PATH],
        updated: [],
        deleted: [],
        validation: { schemaVersion: 1, suiteId: DEFAULT_KNOWLEDGE_SUITE_ID, contentHash },
      }),
  });
  return true;
}

/** Whether a peer's exchangeable scope binds the suite, read defensively from replicated state. */
function peerBindsSuite(scope: unknown, suiteId: string): boolean {
  const verification = (scope as { verification?: unknown } | null | undefined)?.verification;
  return (
    Array.isArray(verification) &&
    verification.some((suite) => (suite as { suiteId?: unknown } | null)?.suiteId === suiteId)
  );
}

/**
 * Before seeding: a template seed (no `peerScope`) gets the default suite when the repository has
 * none it can bind; a peer seed gets it only when the peer's scope binds it. Any other peer seed
 * installs what the peer binds (ADR-0477).
 */
export async function ensureSeedDefaultSuite(input: {
  storage: ProjectStorage;
  now: Date;
  /** The peer's scope for a peer seed; undefined for a template seed. */
  peerScope?: unknown;
}): Promise<boolean> {
  if (input.peerScope === undefined)
    return ensureDefaultKnowledgeSuite({ storage: input.storage, now: input.now });
  if (!peerBindsSuite(input.peerScope, DEFAULT_KNOWLEDGE_SUITE_ID)) return false;
  return ensureDefaultKnowledgeSuite({ storage: input.storage, now: input.now, boundByPeer: true });
}
