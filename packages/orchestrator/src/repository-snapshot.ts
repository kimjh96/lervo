import { createHash } from "node:crypto";
import { lstat, readdir, readlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { readRepositoryFile } from "@roven/context";

import { ManagedProviderRunError } from "./provider-run-types.js";

export interface RepositorySnapshot {
  revision: string;
  files: Readonly<Record<string, string>>;
}

export type CaptureRepositorySnapshot = (
  repositoryRoot: string,
) => Promise<RepositorySnapshot>;

const excludedDirectories = new Set([".git", "node_modules"]);
const MAX_FILES = 20_000;
const MAX_BYTES = 256 * 1024 * 1024;

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function portablePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function isExcluded(path: string, name: string): boolean {
  if (excludedDirectories.has(name)) return true;
  return path === ".roven/state";
}

export async function captureRepositorySnapshot(
  repositoryRoot: string,
): Promise<RepositorySnapshot> {
  const root = resolve(repositoryRoot);
  try {
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("unsafe root");
  } catch {
    throw new ManagedProviderRunError(
      "repository_snapshot_failed",
      "저장소 snapshot root가 안전한 실제 디렉터리가 아닙니다.",
    );
  }
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  let fileCount = 0;
  let byteCount = 0;

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new ManagedProviderRunError(
        "repository_snapshot_failed",
        "저장소 snapshot을 읽지 못했습니다.",
      );
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const path = portablePath(root, absolutePath);
      if (entry.isDirectory()) {
        if (!isExcluded(path, entry.name)) await visit(absolutePath);
        continue;
      }
      fileCount += 1;
      if (fileCount > MAX_FILES) {
        throw new ManagedProviderRunError(
          "repository_snapshot_failed",
          "저장소 snapshot 파일 수 제한을 넘었습니다.",
        );
      }
      if (entry.isSymbolicLink()) {
        const target = await readlink(absolutePath);
        files[path] = sha256(`symlink\0${target}`);
        continue;
      }
      if (!entry.isFile()) {
        files[path] = sha256("unsupported-entry");
        continue;
      }
      try {
        const before = await lstat(absolutePath, { bigint: true });
        const bytes = await readRepositoryFile(root, path);
        const after = await lstat(absolutePath, { bigint: true });
        if (
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs
        ) {
          throw new Error("changed while reading");
        }
        byteCount += bytes.byteLength;
        if (byteCount > MAX_BYTES) {
          throw new ManagedProviderRunError(
            "repository_snapshot_failed",
            "저장소 snapshot byte 제한을 넘었습니다.",
          );
        }
        files[path] = sha256(bytes);
      } catch (error) {
        if (error instanceof ManagedProviderRunError) throw error;
        throw new ManagedProviderRunError(
          "repository_snapshot_failed",
          "저장소 파일을 안전하게 snapshot하지 못했습니다.",
        );
      }
    }
  }

  await visit(root);
  const canonicalEntries = Object.keys(files)
    .sort()
    .map((path) => [path, files[path]]);
  return {
    revision: sha256(JSON.stringify(canonicalEntries)),
    files,
  };
}

export function changedRepositoryPaths(
  before: RepositorySnapshot,
  after: RepositorySnapshot,
): string[] {
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  return [...paths]
    .filter((path) => before.files[path] !== after.files[path])
    .sort();
}
