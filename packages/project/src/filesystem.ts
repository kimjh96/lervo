import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

export type FileSystemEntry =
  | { kind: "missing" }
  | { kind: "directory" }
  | { kind: "file"; content: string }
  | { kind: "unsupported"; description: string };

export function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function readEntry(path: string): Promise<FileSystemEntry> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      return { kind: "unsupported", description: "심볼릭 링크" };
    }
    if (stats.isDirectory()) {
      return { kind: "directory" };
    }
    if (stats.isFile()) {
      return { kind: "file", content: await readFile(path, "utf8") };
    }
    return { kind: "unsupported", description: "일반 파일이나 디렉터리가 아닌 항목" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { kind: "missing" };
    }
    if (code === "ENOTDIR") {
      return { kind: "unsupported", description: "상위 경로가 디렉터리가 아닌 항목" };
    }
    throw error;
  }
}
