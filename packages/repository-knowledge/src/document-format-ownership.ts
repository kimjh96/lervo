import { posix } from "node:path";

import { parse } from "yaml";

const NORMALIZATION_RECORD_ROOT = ".lervo/knowledge/document-normalizations/";
const DOCUMENT_MANIFEST_ROOT = ".lervo/documents/";
const LEGACY_DOCUMENT_REGISTRY = ".lervo/documents.yaml";

/** Repository paths whose content can assign exact document bytes to a Lervo lifecycle. */
export function isDocumentFormatOwnershipSource(path: string): boolean {
  return (
    (path.startsWith(NORMALIZATION_RECORD_ROOT) && path.endsWith(".yaml")) ||
    (path.startsWith(DOCUMENT_MANIFEST_ROOT) &&
      path.endsWith(".yaml") &&
      !path.slice(DOCUMENT_MANIFEST_ROOT.length).includes("/")) ||
    path === LEGACY_DOCUMENT_REGISTRY
  );
}

/** The roots to list when collecting every ownership source of one tree. */
export const DOCUMENT_FORMAT_OWNERSHIP_ROOTS = [
  NORMALIZATION_RECORD_ROOT.slice(0, -1),
  DOCUMENT_MANIFEST_ROOT.slice(0, -1),
  LEGACY_DOCUMENT_REGISTRY,
] as const;

const validPath = (path: unknown): path is string =>
  typeof path === "string" &&
  path !== "" &&
  path === posix.normalize(path) &&
  !posix.isAbsolute(path) &&
  path !== ".." &&
  !path.startsWith("../");

function parseYaml(content: string): unknown {
  try {
    return parse(content) as unknown;
  } catch {
    return null;
  }
}

function sourceOwnedPaths(path: string, content: string): string[] {
  const value = parseYaml(content) as Record<string, unknown> | null;
  if (value === null || typeof value !== "object") return [];
  if (path.startsWith(NORMALIZATION_RECORD_ROOT)) {
    const outputs = Array.isArray(value.outputs) ? (value.outputs as unknown[]) : [];
    return outputs
      .map((output) => (output as { path?: unknown } | null)?.path)
      .filter((output) => validPath(output));
  }
  const records =
    path === LEGACY_DOCUMENT_REGISTRY
      ? Object.values((value.documents as Record<string, unknown> | null) ?? {})
      : [value.record];
  return records.flatMap((record) => {
    const item = record as { path?: unknown; ownership?: { mode?: unknown } } | null;
    const mode = item?.ownership?.mode;
    return validPath(item?.path) && (mode === "managed_blocks" || mode === "lervo_generated")
      ? [item.path]
      : [];
  });
}

/**
 * Paths whose exact bytes a Lervo document lifecycle owns, so an external formatter must never
 * rewrite them: outputs of reviewed normalization records and managed or generated documents in
 * the ownership registry. It mirrors the repository formatter wrapper's ownership rule; a source
 * that cannot be parsed contributes nothing here, while the wrapper's own check fails closed.
 */
export function documentFormatOwnedPaths(
  sources: Iterable<{ path: string; content: string }>,
): Set<string> {
  const owned = new Set<string>();
  for (const source of sources)
    if (isDocumentFormatOwnershipSource(source.path))
      for (const path of sourceOwnedPaths(source.path, source.content)) owned.add(path);
  return owned;
}
