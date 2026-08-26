import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

import { listKnowledgeArtifactPaths } from "./artifact-paths.js";
import type { DurableKnowledgeDeleteOperation } from "./durable-apply.js";
import { sha256 } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

async function readNormalizationRecord(
  root: string,
  path: string,
): Promise<{ contentHash: string; sourcePath: string | null }> {
  let handle;
  try {
    handle = await open(resolve(root, path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size > 1024 * 1024) throw new Error("unsafe record");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    )
      throw new Error("record changed");
    const value = parse(bytes.toString("utf8")) as { sourcePath?: unknown } | null;
    return {
      contentHash: sha256(bytes),
      sourcePath: typeof value?.sourcePath === "string" ? value.sourcePath : null,
    };
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "A document normalization lifecycle record cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

export async function normalizationRecordRetirementOperations(
  root: string,
  sourcePath: string,
): Promise<{ paths: string[]; operations: DurableKnowledgeDeleteOperation[] }> {
  const paths = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/document-normalizations",
    extension: "yaml",
    maximumFiles: 20_000,
  });
  const matched: string[] = [];
  const operations: DurableKnowledgeDeleteOperation[] = [];
  for (const path of paths) {
    const record = await readNormalizationRecord(root, path);
    if (record.sourcePath !== sourcePath) continue;
    matched.push(path);
    operations.push({ path, action: "delete", expectedCurrentHash: record.contentHash });
  }
  return { paths: matched, operations };
}
