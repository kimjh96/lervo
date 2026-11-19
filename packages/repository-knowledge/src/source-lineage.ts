import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { parse, stringify } from "yaml";

import { listKnowledgeArtifactPaths, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

const LINEAGE_DIRECTORY = ".lervo/knowledge/source-lineage";
// Lineage records are never deleted, and one layout migration writes one per moved document, so
// the bound matches the knowledge source inventory (20,000) instead of a few hundred.
const MAX_LINEAGES = 20_000;
const MAX_LINEAGE_BYTES = 64 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/;

export interface DocumentMoveLineage {
  schemaVersion: 1;
  lineageId: string;
  operationId: string;
  kind: "document_move";
  fromPath: string;
  toPath: string;
  identityPath: string;
  sourceId: string;
  sourceContentHash: string;
  sourceUnitBindingDigest: string;
  sourceUnitCount: number;
  closure?:
    | { kind: "document_deleted"; operationId: string; sourceContentHash: string }
    | {
        kind: "document_merged";
        operationId: string;
        sourceContentHash: string;
        destinationPath: string;
        destinationSourceId: string;
      };
}

export interface DocumentSplitLineage {
  schemaVersion: 1;
  lineageId: string;
  operationId: string;
  kind: "document_split";
  sourcePath: string;
  destinationPath: string;
  identityPath: string;
  sourceId: string;
  sourceBeforeHash: string;
  sourceBeforeByteCount: number;
  sourceAfterHash: string;
  destinationHash: string;
  selectedHeadingLocator: string;
  extractedRange: { startByte: number; endByte: number };
  sourceUnitBindingDigest: string;
  sourceUnitCount: number;
}

export interface DocumentMergeLineage {
  schemaVersion: 1;
  lineageId: string;
  operationId: string;
  kind: "document_merge";
  sourcePath: string;
  destinationPath: string;
  sourceIdentityPath: string;
  sourceId: string;
  destinationIdentityPath: string;
  destinationSourceId: string;
  sourceHash: string;
  sourceByteCount: number;
  destinationBeforeHash: string;
  destinationBeforeByteCount: number;
  destinationAfterHash: string;
  destinationAfterByteCount: number;
  composition: "destination_then_source";
  sourceUnitBindingDigest: string;
  sourceUnitCount: number;
  destinationUnitBindingDigest: string;
  destinationUnitCount: number;
}

type DocumentLineage = DocumentMoveLineage | DocumentSplitLineage | DocumentMergeLineage;

export interface LoadedDocumentMoveLineage {
  file: string;
  bytes: Buffer;
  value: DocumentMoveLineage;
  activeTerminal: boolean;
}

export function normalizeKnowledgeDocumentPath(root: string, value: string): string {
  if (
    value.length === 0 ||
    value.length > 500 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    !/\.mdx?$/iu.test(value)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "A document structure target must be a repository-relative Markdown path.",
    );
  }
  const child = relative(root, resolve(root, value));
  const normalized = child.split(sep).join("/");
  if (
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    normalized !== value ||
    normalized.startsWith(".lervo/") ||
    normalized.startsWith(".git/")
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The document structure target path is outside the allowed scope.",
    );
  }
  return normalized;
}

function immutableMoveMaterials(
  value: DocumentMoveLineage,
): Omit<DocumentMoveLineage, "schemaVersion" | "lineageId" | "closure"> {
  const {
    schemaVersion: _schemaVersion,
    lineageId: _lineageId,
    closure: _closure,
    ...materials
  } = value;
  return materials;
}

export function createDocumentMoveLineage(input: {
  projectId: string;
  operationId: string;
  fromPath: string;
  toPath: string;
  identityPath: string;
  sourceId: string;
  sourceContentHash: string;
  sourceUnitIds: string[];
}): { file: string; content: string; value: DocumentMoveLineage } {
  const materials = {
    operationId: input.operationId,
    kind: "document_move" as const,
    fromPath: input.fromPath,
    toPath: input.toPath,
    identityPath: input.identityPath,
    sourceId: input.sourceId,
    sourceContentHash: input.sourceContentHash,
    sourceUnitBindingDigest: sha256(canonicalJson([...input.sourceUnitIds].sort())),
    sourceUnitCount: input.sourceUnitIds.length,
  };
  const lineageId = stableId("klineage", { projectId: input.projectId, ...materials });
  const value: DocumentMoveLineage = { schemaVersion: 1, lineageId, ...materials };
  return {
    file: shardedKnowledgeArtifactPath(LINEAGE_DIRECTORY, lineageId, "yaml"),
    content: stringify(value, { lineWidth: 0, sortMapEntries: true }),
    value,
  };
}

export function createDocumentSplitLineage(input: {
  projectId: string;
  operationId: string;
  sourcePath: string;
  destinationPath: string;
  identityPath: string;
  sourceId: string;
  sourceBeforeHash: string;
  sourceBeforeByteCount: number;
  sourceAfterHash: string;
  destinationHash: string;
  selectedHeadingLocator: string;
  extractedRange: { startByte: number; endByte: number };
  sourceUnitIds: string[];
}): { file: string; content: string; value: DocumentSplitLineage } {
  const materials = {
    operationId: input.operationId,
    kind: "document_split" as const,
    sourcePath: input.sourcePath,
    destinationPath: input.destinationPath,
    identityPath: input.identityPath,
    sourceId: input.sourceId,
    sourceBeforeHash: input.sourceBeforeHash,
    sourceBeforeByteCount: input.sourceBeforeByteCount,
    sourceAfterHash: input.sourceAfterHash,
    destinationHash: input.destinationHash,
    selectedHeadingLocator: input.selectedHeadingLocator,
    extractedRange: input.extractedRange,
    sourceUnitBindingDigest: sha256(canonicalJson([...input.sourceUnitIds].sort())),
    sourceUnitCount: input.sourceUnitIds.length,
  };
  const lineageId = stableId("klineage", { projectId: input.projectId, ...materials });
  const value: DocumentSplitLineage = { schemaVersion: 1, lineageId, ...materials };
  return {
    file: shardedKnowledgeArtifactPath(LINEAGE_DIRECTORY, lineageId, "yaml"),
    content: stringify(value, { lineWidth: 0, sortMapEntries: true }),
    value,
  };
}

export function createDocumentMergeLineage(input: {
  projectId: string;
  operationId: string;
  sourcePath: string;
  destinationPath: string;
  sourceIdentityPath: string;
  sourceId: string;
  destinationIdentityPath: string;
  destinationSourceId: string;
  sourceHash: string;
  sourceByteCount: number;
  destinationBeforeHash: string;
  destinationBeforeByteCount: number;
  destinationAfterHash: string;
  destinationAfterByteCount: number;
  sourceUnitIds: string[];
  destinationUnitIds: string[];
}): { file: string; content: string; value: DocumentMergeLineage } {
  const materials = {
    operationId: input.operationId,
    kind: "document_merge" as const,
    sourcePath: input.sourcePath,
    destinationPath: input.destinationPath,
    sourceIdentityPath: input.sourceIdentityPath,
    sourceId: input.sourceId,
    destinationIdentityPath: input.destinationIdentityPath,
    destinationSourceId: input.destinationSourceId,
    sourceHash: input.sourceHash,
    sourceByteCount: input.sourceByteCount,
    destinationBeforeHash: input.destinationBeforeHash,
    destinationBeforeByteCount: input.destinationBeforeByteCount,
    destinationAfterHash: input.destinationAfterHash,
    destinationAfterByteCount: input.destinationAfterByteCount,
    composition: "destination_then_source" as const,
    sourceUnitBindingDigest: sha256(canonicalJson([...input.sourceUnitIds].sort())),
    sourceUnitCount: input.sourceUnitIds.length,
    destinationUnitBindingDigest: sha256(canonicalJson([...input.destinationUnitIds].sort())),
    destinationUnitCount: input.destinationUnitIds.length,
  };
  const lineageId = stableId("klineage", { projectId: input.projectId, ...materials });
  const value: DocumentMergeLineage = { schemaVersion: 1, lineageId, ...materials };
  return {
    file: shardedKnowledgeArtifactPath(LINEAGE_DIRECTORY, lineageId, "yaml"),
    content: stringify(value, { lineWidth: 0, sortMapEntries: true }),
    value,
  };
}

async function safeRead(path: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_LINEAGE_BYTES) throw new Error("unsafe lineage");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    )
      throw new Error("lineage changed");
    return bytes;
  } finally {
    await handle?.close();
  }
}

function validMoveLineage(
  value: unknown,
  name: string,
  projectId: string,
  root: string,
): value is DocumentMoveLineage {
  const item = value as DocumentMoveLineage | null;
  if (
    item === null ||
    typeof item !== "object" ||
    item.schemaVersion !== 1 ||
    item.kind !== "document_move" ||
    !/^klineage_[a-f0-9]{24}$/.test(item.lineageId) ||
    `${item.lineageId}.yaml` !== name ||
    !/^kdocop_[a-f0-9]{24}$/.test(item.operationId) ||
    !/^src_[a-f0-9]{24}$/.test(item.sourceId) ||
    !HASH.test(item.sourceContentHash) ||
    !HASH.test(item.sourceUnitBindingDigest) ||
    !Number.isSafeInteger(item.sourceUnitCount) ||
    item.sourceUnitCount < 1 ||
    item.sourceUnitCount > 16384 ||
    (item.closure !== undefined &&
      (!/^kdocop_[a-f0-9]{24}$/.test(item.closure.operationId) ||
        !HASH.test(item.closure.sourceContentHash) ||
        (item.closure.kind !== "document_deleted" &&
          (item.closure.kind !== "document_merged" ||
            !/^src_[a-f0-9]{24}$/.test(item.closure.destinationSourceId) ||
            (() => {
              try {
                normalizeKnowledgeDocumentPath(root, item.closure.destinationPath);
                return false;
              } catch {
                return true;
              }
            })()))))
  )
    return false;
  try {
    normalizeKnowledgeDocumentPath(root, item.fromPath);
    normalizeKnowledgeDocumentPath(root, item.toPath);
    normalizeKnowledgeDocumentPath(root, item.identityPath);
  } catch {
    return false;
  }
  if (
    item.fromPath === item.toPath ||
    item.sourceId !== stableId("src", { projectId, path: item.identityPath })
  )
    return false;
  return item.lineageId === stableId("klineage", { projectId, ...immutableMoveMaterials(item) });
}

function validSplitLineage(
  value: unknown,
  name: string,
  projectId: string,
  root: string,
): value is DocumentSplitLineage {
  const item = value as DocumentSplitLineage | null;
  if (
    item === null ||
    typeof item !== "object" ||
    item.schemaVersion !== 1 ||
    item.kind !== "document_split" ||
    !/^klineage_[a-f0-9]{24}$/.test(item.lineageId) ||
    `${item.lineageId}.yaml` !== name ||
    !/^kdocop_[a-f0-9]{24}$/.test(item.operationId) ||
    !/^src_[a-f0-9]{24}$/.test(item.sourceId) ||
    !HASH.test(item.sourceBeforeHash) ||
    !HASH.test(item.sourceAfterHash) ||
    !HASH.test(item.destinationHash) ||
    !HASH.test(item.sourceUnitBindingDigest) ||
    !Number.isSafeInteger(item.sourceBeforeByteCount) ||
    item.sourceBeforeByteCount < 1 ||
    item.sourceBeforeByteCount > 16 * 1024 * 1024 ||
    typeof item.selectedHeadingLocator !== "string" ||
    !item.selectedHeadingLocator.startsWith("heading:") ||
    item.selectedHeadingLocator.length > 500 ||
    !Number.isSafeInteger(item.extractedRange?.startByte) ||
    !Number.isSafeInteger(item.extractedRange?.endByte) ||
    item.extractedRange.startByte <= 0 ||
    item.extractedRange.endByte <= item.extractedRange.startByte ||
    item.extractedRange.endByte > item.sourceBeforeByteCount ||
    !Number.isSafeInteger(item.sourceUnitCount) ||
    item.sourceUnitCount < 1 ||
    item.sourceUnitCount > 16384
  )
    return false;
  try {
    normalizeKnowledgeDocumentPath(root, item.sourcePath);
    normalizeKnowledgeDocumentPath(root, item.destinationPath);
    normalizeKnowledgeDocumentPath(root, item.identityPath);
  } catch {
    return false;
  }
  if (
    item.sourcePath === item.destinationPath ||
    item.sourceId !== stableId("src", { projectId, path: item.identityPath })
  )
    return false;
  const { schemaVersion: _schemaVersion, lineageId: _lineageId, ...materials } = item;
  return item.lineageId === stableId("klineage", { projectId, ...materials });
}

function validMergeLineage(
  value: unknown,
  name: string,
  projectId: string,
  root: string,
): value is DocumentMergeLineage {
  const item = value as DocumentMergeLineage | null;
  if (
    item === null ||
    typeof item !== "object" ||
    item.schemaVersion !== 1 ||
    item.kind !== "document_merge" ||
    item.composition !== "destination_then_source" ||
    !/^klineage_[a-f0-9]{24}$/.test(item.lineageId) ||
    `${item.lineageId}.yaml` !== name ||
    !/^kdocop_[a-f0-9]{24}$/.test(item.operationId) ||
    !/^src_[a-f0-9]{24}$/.test(item.sourceId) ||
    !/^src_[a-f0-9]{24}$/.test(item.destinationSourceId) ||
    !HASH.test(item.sourceHash) ||
    !HASH.test(item.destinationBeforeHash) ||
    !HASH.test(item.destinationAfterHash) ||
    !HASH.test(item.sourceUnitBindingDigest) ||
    !HASH.test(item.destinationUnitBindingDigest) ||
    !Number.isSafeInteger(item.sourceByteCount) ||
    item.sourceByteCount < 1 ||
    !Number.isSafeInteger(item.destinationBeforeByteCount) ||
    item.destinationBeforeByteCount < 1 ||
    !Number.isSafeInteger(item.destinationAfterByteCount) ||
    item.destinationAfterByteCount !== item.sourceByteCount + item.destinationBeforeByteCount ||
    item.destinationAfterByteCount > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(item.sourceUnitCount) ||
    item.sourceUnitCount < 1 ||
    item.sourceUnitCount > 16384 ||
    !Number.isSafeInteger(item.destinationUnitCount) ||
    item.destinationUnitCount < 1 ||
    item.destinationUnitCount > 16384
  )
    return false;
  try {
    normalizeKnowledgeDocumentPath(root, item.sourcePath);
    normalizeKnowledgeDocumentPath(root, item.destinationPath);
    normalizeKnowledgeDocumentPath(root, item.sourceIdentityPath);
    normalizeKnowledgeDocumentPath(root, item.destinationIdentityPath);
  } catch {
    return false;
  }
  if (
    item.sourcePath === item.destinationPath ||
    item.sourceId === item.destinationSourceId ||
    item.sourceId !== stableId("src", { projectId, path: item.sourceIdentityPath }) ||
    item.destinationSourceId !== stableId("src", { projectId, path: item.destinationIdentityPath })
  )
    return false;
  const { schemaVersion: _schemaVersion, lineageId: _lineageId, ...materials } = item;
  return item.lineageId === stableId("klineage", { projectId, ...materials });
}

function validLineage(
  value: unknown,
  name: string,
  projectId: string,
  root: string,
): value is DocumentLineage {
  const kind = (value as { kind?: unknown } | null)?.kind;
  return kind === "document_move"
    ? validMoveLineage(value, name, projectId, root)
    : kind === "document_split"
      ? validSplitLineage(value, name, projectId, root)
      : kind === "document_merge" && validMergeLineage(value, name, projectId, root);
}

export async function loadDocumentMoveLineages(input: {
  repositoryRoot: string;
  projectId: string;
}): Promise<{
  identityPathByCurrentPath: Map<string, string>;
  records: LoadedDocumentMoveLineage[];
}> {
  const root = resolve(input.repositoryRoot);
  const files = await listKnowledgeArtifactPaths({
    root,
    directory: LINEAGE_DIRECTORY,
    extension: "yaml",
    maximumFiles: MAX_LINEAGES,
  });
  const loaded: Array<{ file: string; bytes: Buffer; value: DocumentLineage }> = [];
  try {
    const ids = new Set<string>();
    for (const file of files) {
      const name = file.split("/").at(-1)!;
      const bytes = await safeRead(resolve(root, file));
      const value: unknown = parse(bytes.toString("utf8"));
      if (!validLineage(value, name, input.projectId, root)) throw new Error("invalid lineage");
      const lineageId = (value as DocumentLineage).lineageId;
      if (
        ids.has(lineageId) ||
        (file.split("/").length > 4 &&
          file !== shardedKnowledgeArtifactPath(LINEAGE_DIRECTORY, lineageId, "yaml"))
      )
        throw new Error("duplicate or misplaced lineage");
      ids.add(lineageId);
      loaded.push({ file, bytes, value });
    }
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The document move lineage is invalid.",
    );
  }
  const moves = loaded.filter(
    (item): item is { file: string; bytes: Buffer; value: DocumentMoveLineage } =>
      item.value.kind === "document_move",
  );
  const byFrom = new Map<string, DocumentMoveLineage>();
  const byTo = new Map<string, DocumentMoveLineage>();
  for (const item of moves) {
    if (byFrom.has(item.value.fromPath) || byTo.has(item.value.toPath)) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "The document move lineage branches or merges.",
      );
    }
    byFrom.set(item.value.fromPath, item.value);
    byTo.set(item.value.toPath, item.value);
  }
  for (const item of moves) {
    const visited = new Set<string>();
    let cursor = item.value.toPath;
    while (byTo.has(cursor)) {
      if (visited.has(cursor))
        throw new RepositoryKnowledgeError(
          "knowledge_source_unsafe",
          "The document move lineage contains a cycle.",
        );
      visited.add(cursor);
      cursor = byTo.get(cursor)!.fromPath;
    }
    if (cursor !== item.value.identityPath)
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "The document move lineage identity root does not match.",
      );
  }
  const identityPathByCurrentPath = new Map<string, string>();
  const records: LoadedDocumentMoveLineage[] = moves.map((item) => {
    const activeTerminal = !byFrom.has(item.value.toPath) && item.value.closure === undefined;
    if (activeTerminal) identityPathByCurrentPath.set(item.value.toPath, item.value.identityPath);
    return { ...item, activeTerminal };
  });
  return { identityPathByCurrentPath, records };
}
