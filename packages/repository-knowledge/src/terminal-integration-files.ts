import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { sha256 } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";
import { MAXIMUM_CONFIG_BYTES } from "./terminal-integration-contract.js";

export async function safeOptionalBytes(
  path: string,
  maximumBytes: number,
): Promise<Buffer | null> {
  let handle;
  try {
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maximumBytes)
        throw new Error("unsafe");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximumBytes) throw new Error("unsafe");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      length !== before.size
    )
      throw new Error("changed");
    return bytes.subarray(0, length);
  } catch (error) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "A terminal integration file cannot be read safely.",
      undefined,
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

export async function safeOptionalText(
  path: string,
  maximumBytes = MAXIMUM_CONFIG_BYTES,
): Promise<{ content: string; contentHash: string } | null> {
  const bytes = await safeOptionalBytes(path, maximumBytes);
  if (bytes === null) return null;
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      contentHash: sha256(bytes),
    };
  } catch (error) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "A terminal integration file is not valid UTF-8.",
      undefined,
      { cause: error },
    );
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
