import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { lervoRelativePaths } from "@lervo/project";

import type { RepositoryKnowledgeScan } from "./types.js";

export interface IncrementalReconciliationSummary {
  strategy: "full" | "integration_head_incremental";
  basisSnapshotId: string | null;
  changedSourceCount: number;
  reusedSourceCount: number;
  removedSourceCount: number;
}

interface InventorySource {
  sourceId: string;
  contentHash?: string | null;
  status: string;
}

async function previousInventory(root: string): Promise<{
  snapshotId: string;
  sources: InventorySource[];
} | null> {
  const path = resolve(root, lervoRelativePaths.knowledgeInventory);
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 32 * 1024 * 1024) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<{
      snapshotId: string;
      sources: InventorySource[];
    }>;
    if (
      typeof value.snapshotId !== "string" ||
      !Array.isArray(value.sources) ||
      !value.sources.every(
        (source) =>
          typeof source?.sourceId === "string" &&
          typeof source.status === "string" &&
          (source.contentHash == null || typeof source.contentHash === "string"),
      )
    )
      return null;
    return { snapshotId: value.snapshotId, sources: value.sources };
  } catch {
    return null;
  }
}

export async function summarizeIncrementalReconciliation(input: {
  repositoryRoot: string;
  scan: RepositoryKnowledgeScan;
  strategy: IncrementalReconciliationSummary["strategy"];
}): Promise<IncrementalReconciliationSummary> {
  if (input.strategy === "full")
    return {
      strategy: "full",
      basisSnapshotId: null,
      changedSourceCount: input.scan.sources.length,
      reusedSourceCount: 0,
      removedSourceCount: 0,
    };
  const previous = await previousInventory(input.repositoryRoot);
  if (previous === null)
    return {
      strategy: input.strategy,
      basisSnapshotId: null,
      changedSourceCount: input.scan.sources.length,
      reusedSourceCount: 0,
      removedSourceCount: 0,
    };
  const before = new Map(
    previous.sources.map((source) => [
      source.sourceId,
      `${source.status}\0${source.contentHash ?? "unavailable"}`,
    ]),
  );
  let reusedSourceCount = 0;
  let changedSourceCount = 0;
  for (const source of input.scan.sources) {
    const coordinate = `${source.status}\0${source.contentHash ?? "unavailable"}`;
    if (before.get(source.sourceId) === coordinate) reusedSourceCount += 1;
    else changedSourceCount += 1;
    before.delete(source.sourceId);
  }
  return {
    strategy: input.strategy,
    basisSnapshotId: previous.snapshotId,
    changedSourceCount,
    reusedSourceCount,
    removedSourceCount: before.size,
  };
}
