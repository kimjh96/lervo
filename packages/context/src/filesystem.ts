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
      `저장소 root를 확인할 수 없습니다: ${absoluteRoot}`,
      { cause: error },
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ContextPreparationError(
      "unsafe_document_path",
      `저장소 root는 실제 디렉터리여야 합니다: ${absoluteRoot}`,
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
        `문서 경로를 확인할 수 없습니다: ${normalized}`,
        { cause: error },
      );
    }
    if (stats.isSymbolicLink()) {
      throw new ContextPreparationError(
        "unsafe_document_path",
        `문서 경로는 심볼릭 링크를 포함할 수 없습니다: ${normalized}`,
      );
    }
    const final = index === segments.length - 1;
    if (final ? !stats.isFile() : !stats.isDirectory()) {
      throw new ContextPreparationError(
        "unsafe_document_path",
        `문서 경로는 실제 파일과 디렉터리만 포함해야 합니다: ${normalized}`,
      );
    }
  }
  const pathFromRoot = relative(canonicalRoot, current);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") {
    throw new ContextPreparationError(
      "unsafe_document_path",
      `문서 경로가 저장소 밖을 가리킵니다: ${normalized}`,
    );
  }
  return { absolutePath: current, kind: "file" };
}

export async function repositoryFileExists(root: string, path: string): Promise<boolean> {
  return (await inspectPath(root, path)).kind === "file";
}

export async function readRepositoryFile(root: string, path: string): Promise<Uint8Array> {
  const inspected = await inspectPath(root, path);
  const normalized = normalizeRepositoryPath(path);
  if (inspected.kind === "missing") {
    throw new ContextPreparationError(
      "document_missing",
      `선택한 문서가 없습니다: ${normalized}`,
    );
  }

  let handle;
  try {
    handle = await open(
      inspected.absolutePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const beforeStats = await handle.stat({ bigint: true });
    if (!beforeStats.isFile()) {
      throw new ContextPreparationError(
        "unsafe_document_path",
        `선택한 문서는 실제 파일이어야 합니다: ${normalized}`,
      );
    }
    const before = identity(beforeStats);
    const bytes = await handle.readFile();
    const after = identity(await handle.stat({ bigint: true }));
    const pathStats = await lstat(inspected.absolutePath, { bigint: true });
    const resolvedPath = await realpath(inspected.absolutePath);
    if (
      !sameIdentity(before, after) ||
      pathStats.isSymbolicLink() ||
      pathStats.dev !== after.dev ||
      pathStats.ino !== after.ino ||
      resolvedPath !== inspected.absolutePath
    ) {
      throw new ContextPreparationError(
        "document_changed_during_read",
        `문서를 읽는 동안 경로나 내용이 바뀌었습니다: ${normalized}`,
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof ContextPreparationError) throw error;
    throw new ContextPreparationError(
      "document_read_failed",
      `문서를 읽을 수 없습니다: ${normalized}`,
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}
