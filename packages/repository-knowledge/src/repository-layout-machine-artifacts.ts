import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stringify } from "yaml";

import { listKnowledgeArtifactPaths, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import type { DurableKnowledgeMoveOperation } from "./durable-apply.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { legacyNormalizationRecord } from "./normalization-record-version.js";
import { repositoryPathExists } from "./repository-layout-destinations.js";
import type {
  RepositoryLayoutMachineMove,
  RepositoryLayoutMigrationPlan,
} from "./repository-layout-plan.js";
import type { StoredConcept, StoredValue } from "./store-reader.js";
import { RepositoryKnowledgeError, type KnowledgeFileOperation } from "./types.js";

async function safeFile(
  path: string,
  maximumBytes = 256 * 1024,
): Promise<{ contentHash: string; byteCount: number }> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes)
      throw new Error("unsafe registry item");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    )
      throw new Error("registry changed");
    return { contentHash: sha256(bytes), byteCount: bytes.byteLength };
  } catch (error) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The knowledge registry cannot be read safely.",
      undefined,
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

async function machineArtifactMoves(root: string): Promise<RepositoryLayoutMachineMove[]> {
  const registries = [
    {
      directory: ".lervo/knowledge/bundles",
      extension: "yaml" as const,
      registry: "bundles" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/concepts",
      extension: "yaml" as const,
      registry: "concepts" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/claims",
      extension: "yaml" as const,
      registry: "claims" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/relations",
      extension: "yaml" as const,
      registry: "relations" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/source-lineage",
      extension: "yaml" as const,
      registry: "source_lineage" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/instruction-bridges",
      extension: "yaml" as const,
      registry: "instruction_bridges" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/document-normalizations",
      extension: "yaml" as const,
      registry: "document_normalizations" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/generated/semantic-manifests",
      extension: "json" as const,
      registry: "semantic_manifests" as const,
      maximumBytes: 16 * 1024 * 1024,
    },
    {
      directory: ".lervo/state/knowledge/candidates",
      extension: "json" as const,
      registry: "candidates" as const,
      maximumBytes: 32 * 1024 * 1024,
    },
  ];
  const moves: RepositoryLayoutMachineMove[] = [];
  for (const item of registries) {
    const paths = await listKnowledgeArtifactPaths({
      root,
      directory: item.directory,
      extension: item.extension,
      maximumFiles: 20_000,
    });
    for (const fromPath of paths.filter(
      (path) => !path.slice(item.directory.length + 1).includes("/"),
    )) {
      const name = fromPath.split("/").at(-1)!;
      const id = name.slice(0, -(item.extension.length + 1));
      const toPath = shardedKnowledgeArtifactPath(item.directory, id, item.extension);
      const file = await safeFile(resolve(root, fromPath), item.maximumBytes);
      moves.push({ fromPath, toPath, ...file, registry: item.registry });
    }
  }
  return moves.sort((left, right) => left.fromPath.localeCompare(right.fromPath));
}

export async function normalizationOwnershipUpgradeOperations(
  root: string,
): Promise<KnowledgeFileOperation[]> {
  const operations: KnowledgeFileOperation[] = [];
  const paths = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/document-normalizations",
    extension: "yaml",
    maximumFiles: 20_000,
  });
  for (const path of paths) {
    const source = await readFile(resolve(root, path), "utf8");
    const value = legacyNormalizationRecord(source);
    if (value === null) continue;
    const content = stringify(
      {
        ...value,
        schemaVersion: 2,
        byteOwnership: { owner: "reviewer", rewritePolicy: "reviewed_exact" },
      },
      { lineWidth: 0, sortMapEntries: true },
    );
    operations.push({
      path,
      action: "update",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content,
      expectedCurrentHash: sha256(source),
      desiredHash: sha256(content),
      reason: "upgrade_document_rewrite_ownership",
    });
  }
  return operations;
}

/** The digest of every stored concept file's exact bytes, in path order. */
export async function repositoryLayoutRegistryDigest(
  root: string,
  storedConcepts: Array<StoredValue<StoredConcept>>,
): Promise<string> {
  const registryMaterials = await Promise.all(
    storedConcepts.map(async (item) => ({
      file: item.file,
      contentHash: (await safeFile(resolve(root, item.file))).contentHash,
    })),
  );
  registryMaterials.sort((left, right) => left.file.localeCompare(right.file));
  return sha256(canonicalJson(registryMaterials));
}

/**
 * Moves flat legacy registry artifacts into their sharded paths, except paths the structural
 * plan already writes, and blocks each move whose destination already exists.
 */
export async function planRepositoryLayoutMachineMoves(
  root: string,
  structuralPaths: ReadonlySet<string>,
): Promise<{
  machineMoves: RepositoryLayoutMachineMove[];
  machineMoveOperations: DurableKnowledgeMoveOperation[];
  blockers: RepositoryLayoutMigrationPlan["blockers"];
}> {
  const machineMoves = (await machineArtifactMoves(root)).filter(
    (move) => !structuralPaths.has(move.fromPath) && !structuralPaths.has(move.toPath),
  );
  const blockers: RepositoryLayoutMigrationPlan["blockers"] = [];
  for (const move of machineMoves) {
    if (await repositoryPathExists(resolve(root, move.toPath)))
      blockers.push({ code: "destination_exists", pathDigest: sha256(move.toPath) });
  }
  const machineMoveOperations: DurableKnowledgeMoveOperation[] = machineMoves.map((move) => ({
    path: move.fromPath,
    destinationPath: move.toPath,
    action: "move",
    expectedCurrentHash: move.contentHash,
  }));
  return { machineMoves, machineMoveOperations, blockers };
}
