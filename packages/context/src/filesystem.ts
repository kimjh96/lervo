import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { normalizeRepositoryPath } from "./paths.js";
import { ContextPreparationError } from "./types.js";

interface FileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

function identity(stats: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function canonicalRepositoryRoot(root: string): Promise<string> {
  const absoluteRoot = resolve(root);
  let stats;
  try {
    stats = await lstat(absoluteRoot);
  } catch (error) {
    throw new ContextPreparationError(
      "unsafe_document_path",
      `The repository root cannot be inspected: ${absoluteRoot}`,
      { cause: error },
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ContextPreparationError(
      "unsafe_document_path",
      `The repository root must be a real directory: ${absoluteRoot}`,
    );
  }
  return realpath(absoluteRoot);
}

async function inspectPath(root: string, path: string): Promise<{
  absolutePath: string;
  kind: "file" | "missing";
}> {
  const canonicalRoot = await canonicalRepositoryRoot(root);
  const normalized = normalizeRepositoryPath(path);
  const segments = normalized.split("/");
  let current = canonicalRoot;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { absolutePath: current, kind: "missing" };
      }
      throw new ContextPreparationError(
        "document_read_failed",
        `The document path cannot be inspected: ${normalized}`,
        { cause: error },
      );
    }
    if (stats.isSymbolicLink()) {
      throw new ContextPreparationError(
        "unsafe_document_path",
        `The document path cannot contain symbolic links: ${normalized}`,
      );
    }
    const final = index === segments.length - 1;
    if (final ? !stats.isFile() : !stats.isDirectory()) {
      throw new ContextPreparationError(
        "unsafe_document_path",
        `The document path must contain only real files and directories: ${normalized}`,
      );
    }
  }
  const pathFromRoot = relative(canonicalRoot, current);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") {
    throw new ContextPreparationError(
      "unsafe_document_path",
      `The document path points outside the repository: ${normalized}`,
    );
  }
  return { absolutePath: current, kind: "file" };
}

export async function repositoryFileExists(root: string, path: string): Promise<boolean> {
  return (await inspectPath(root, path)).kind === "file";
}

export async function readRepositoryFile(
  root: string,
  path: string,
  maximumBytes = Number.MAX_SAFE_INTEGER,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new ContextPreparationError("document_read_failed", "The document byte limit is invalid.");
  }
  const inspected = await inspectPath(root, path);
  const normalized = normalizeRepositoryPath(path);
  if (inspected.kind === "missing") {
    throw new ContextPreparationError(
      "document_missing",
      `The selected document is missing: ${normalized}`,
    );
  }

  let handle;
  try {
    handle = await open(
      inspected.absolutePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const beforeStats = await handle.stat({ bigint: true });
    if (!beforeStats.isFile() || beforeStats.size > BigInt(maximumBytes)) {
      throw new ContextPreparationError(
        beforeStats.isFile() ? "document_read_failed" : "unsafe_document_path",
        beforeStats.isFile()
          ? `The selected document exceeds the byte limit: ${normalized}`
          : `The selected document must be a real file: ${normalized}`,
      );
    }
    const before = identity(beforeStats);
    let bytes: Uint8Array;
    let boundedBytesRead: number | undefined;
    if (maximumBytes === Number.MAX_SAFE_INTEGER) {
      bytes = await handle.readFile();
    } else {
      const buffer = Buffer.alloc(Number(beforeStats.size) + 1);
      const result = await handle.read(buffer, 0, buffer.length, 0);
      boundedBytesRead = result.bytesRead;
      bytes = buffer.subarray(0, result.bytesRead);
    }
    const after = identity(await handle.stat({ bigint: true }));
    const pathStats = await lstat(inspected.absolutePath, { bigint: true });
    const resolvedPath = await realpath(inspected.absolutePath);
    if (
      !sameIdentity(before, after) ||
      (boundedBytesRead !== undefined && boundedBytesRead !== Number(before.size)) ||
      after.size > BigInt(maximumBytes) ||
      pathStats.isSymbolicLink() ||
      pathStats.dev !== after.dev ||
      pathStats.ino !== after.ino ||
      resolvedPath !== inspected.absolutePath
    ) {
      throw new ContextPreparationError(
        "document_changed_during_read",
        `The document path or content changed while it was being read: ${normalized}`,
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof ContextPreparationError) throw error;
    throw new ContextPreparationError(
      "document_read_failed",
      `The document cannot be read: ${normalized}`,
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}
