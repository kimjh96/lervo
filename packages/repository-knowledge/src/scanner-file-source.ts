import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { sha256 } from "./integrity.js";
import {
  binaryExtensions,
  generatedEntrypoint,
  opaqueSkillResourceFields,
  repositorySourceClassificationForPath,
} from "./repository-source-classification.js";
import { RepositoryKnowledgeError, type RepositorySource } from "./types.js";

/** A source that moves under the scan is a concurrent edit, not an unsafe source. */
export function concurrentSourceChange(path: string): RepositoryKnowledgeError {
  return new RepositoryKnowledgeError("source_bytes_changed", `${path} changed during the scan.`);
}

async function safeReadFile(absolute: string, source: RepositorySource): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size !== source.byteCount)
      throw concurrentSourceChange(source.path);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw concurrentSourceChange(source.path);
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw concurrentSourceChange(source.path);
    throw error;
  } finally {
    await handle?.close();
  }
}

/** Decode only an admitted candidate; opaque portable resources retain hashes without content. */
export async function readRepositoryFileSource(
  absolute: string,
  source: RepositorySource,
): Promise<RepositorySource | null> {
  const bytes = await safeReadFile(absolute, source);
  const unsupported = (reason: string): RepositorySource => {
    const opaqueFields = opaqueSkillResourceFields(source.path);
    if ("agentArtifact" in opaqueFields)
      return {
        ...source,
        ...opaqueFields,
        status: "included",
        classification: "ordinary",
        byteCount: bytes.byteLength,
        contentHash: sha256(bytes),
        reason: "opaque_portable_skill_resource",
      };
    return { ...source, kind: "other", reason };
  };
  if (binaryExtensions.has(extname(source.path).toLowerCase())) return unsupported("binary_file");
  if (bytes.includes(0)) return unsupported("binary_content");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return unsupported("invalid_utf8");
  }
  if (generatedEntrypoint(source.path, content)) return null;
  const { reason: _reason, ...metadata } = source;
  return {
    ...metadata,
    status: "included",
    classification: repositorySourceClassificationForPath(source.path),
    byteCount: bytes.byteLength,
    contentHash: sha256(bytes),
    content,
  };
}

/**
 * Rereads one observed-only source (ADR-0544) for a transient use. The bytes must still be the
 * observed ones; otherwise the caller acts on a scan that no longer describes the repository.
 */
export async function readObservedSourceText(
  repositoryRoot: string,
  source: RepositorySource,
): Promise<string> {
  if (
    source.status !== "included" ||
    source.contentHash === null ||
    source.path.startsWith("@") ||
    source.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `${source.path} is not an observed repository file.`,
    );
  const bytes = await safeReadFile(resolve(repositoryRoot, ...source.path.split("/")), source);
  if (sha256(bytes) !== source.contentHash) throw concurrentSourceChange(source.path);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
