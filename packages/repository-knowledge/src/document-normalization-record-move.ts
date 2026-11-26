import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, stringify } from "yaml";

import { listKnowledgeArtifactPaths } from "./artifact-paths.js";
import { sha256 } from "./integrity.js";
import { RepositoryKnowledgeError, type KnowledgeFileOperation } from "./types.js";

interface MovableNormalizationRecord {
  sourcePath: string;
  outputs: Array<{ path: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

async function readNormalizationRecord(
  root: string,
  path: string,
): Promise<{ bytes: Buffer; value: MovableNormalizationRecord | null }> {
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
    ) {
      throw new Error("record changed");
    }
    const value = parse(bytes.toString("utf8")) as Partial<MovableNormalizationRecord> | null;
    if (value?.sourcePath !== undefined && typeof value.sourcePath !== "string") {
      throw new Error("invalid source path");
    }
    return { bytes, value: value as MovableNormalizationRecord | null };
  } catch (error) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "A document normalization lifecycle record cannot be read safely.",
      undefined,
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

export async function normalizationRecordMoveOperations(
  root: string,
  fromPath: string,
  toPath: string,
): Promise<{ paths: string[]; operations: KnowledgeFileOperation[] }> {
  const paths = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/document-normalizations",
    extension: "yaml",
    maximumFiles: 20_000,
  });
  const matched: string[] = [];
  const operations: KnowledgeFileOperation[] = [];
  for (const path of paths) {
    const record = await readNormalizationRecord(root, path);
    if (record.value?.sourcePath !== fromPath) continue;
    if (
      !Array.isArray(record.value.outputs) ||
      record.value.outputs.length !== 1 ||
      record.value.outputs[0]?.path !== fromPath
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_reconciliation_conflict",
        "A normalized document family requires a separate reviewed structure move.",
      );
    }
    const next = {
      ...record.value,
      sourcePath: toPath,
      outputs: [{ ...record.value.outputs[0], path: toPath }],
    };
    const content = stringify(next, { sortMapEntries: true });
    matched.push(path);
    operations.push({
      path,
      action: "update",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content,
      expectedCurrentHash: sha256(record.bytes),
      desiredHash: sha256(content),
    });
  }
  return { paths: matched, operations };
}
