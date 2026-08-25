import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { lervoRelativePaths } from "@lervo/project";

import { listKnowledgeArtifactPaths } from "./artifact-paths.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { serializableScan } from "./scanner.js";
import type {
  KnowledgeFileOperation,
  KnowledgeImpactReport,
  RepositoryKnowledgeScan,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

export interface KnowledgeProjectionOutput {
  path: string;
  mediaType: "application/json";
  content: string;
  contentHash: string;
}

function compactJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function sourceUnitProjection(scan: RepositoryKnowledgeScan): object {
  const kinds: Record<string, number> = {};
  for (const unit of scan.units) kinds[unit.unitKind] = (kinds[unit.unitKind] ?? 0) + 1;
  return {
    schemaVersion: 2,
    snapshotId: scan.snapshotId,
    unitCount: scan.units.length,
    sourceCount: scan.sources.length,
    kinds,
    bindingDigest: sha256(
      canonicalJson(
        scan.units.map((unit) => ({
          unitId: unit.unitId,
          unitVersionId: unit.unitVersionId,
          sourceId: unit.sourceId,
        })),
      ),
    ),
  };
}

export function currentKnowledgeProjectionOutputs(
  scan: RepositoryKnowledgeScan,
  impact: KnowledgeImpactReport,
): KnowledgeProjectionOutput[] {
  const values = [
    {
      path: lervoRelativePaths.knowledgeInventory,
      value: serializableScan({ ...scan, units: [] }),
    },
    { path: lervoRelativePaths.knowledgeSourceUnits, value: sourceUnitProjection(scan) },
    { path: lervoRelativePaths.knowledgeImpacts, value: impact },
  ];
  return values.map(({ path, value }) => {
    const content = compactJson(value);
    return { path, mediaType: "application/json", content, contentHash: sha256(content) };
  });
}

async function deleteOperation(root: string, path: string): Promise<KnowledgeFileOperation> {
  const absolute = resolve(root, path);
  const stats = await lstat(absolute);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `Derived state is not a safe regular file: ${path}`,
    );
  const currentHash = sha256(await readFile(absolute));
  return {
    path,
    action: "delete",
    ownership: "lervo_generated",
    mediaType: "application/json",
    expectedCurrentHash: currentHash,
    desiredHash: sha256("lervo:absent\n"),
    reason: "superseded_unbounded_derived_state",
  };
}

export async function legacyKnowledgeProjectionDeleteOperations(
  root: string,
): Promise<KnowledgeFileOperation[]> {
  const directories = [
    ".lervo/state/knowledge/inventory",
    ".lervo/state/knowledge/source-units",
    ".lervo/state/knowledge/impacts",
  ];
  const paths = (
    await Promise.all(
      directories.map((directory) =>
        listKnowledgeArtifactPaths({ root, directory, extension: "json", maximumFiles: 20_000 }),
      ),
    )
  ).flat();
  return Promise.all(paths.map((path) => deleteOperation(root, path)));
}
