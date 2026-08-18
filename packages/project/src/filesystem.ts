import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

export type FileSystemEntry =
  | { kind: "missing" }
  | { kind: "directory" }
  | { kind: "file"; content: string }
  | { kind: "unsupported"; description: string };

export function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function readEntry(
  path: string,
  maximumFileBytes = 4 * 1024 * 1024,
): Promise<FileSystemEntry> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      return { kind: "unsupported", description: "심볼릭 링크" };
    }
    if (stats.isDirectory()) {
      return { kind: "directory" };
    }
    if (stats.isFile()) {
      if (stats.size > maximumFileBytes) {
        return { kind: "unsupported", description: "크기 제한을 넘는 파일" };
      }
      let handle;
      try {
        handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = await handle.stat();
        if (stats.dev !== opened.dev || stats.ino !== opened.ino) {
          return { kind: "unsupported", description: "읽기 전에 바뀐 파일 경로" };
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
          !after.isFile() ||
          after.size > maximumFileBytes ||
          stats.dev !== after.dev ||
          stats.ino !== after.ino ||
          stats.size !== after.size ||
          stats.mtimeMs !== after.mtimeMs
        ) {
          return { kind: "unsupported", description: "읽는 동안 바뀐 파일" };
        }
        try {
          return {
            kind: "file",
            content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          };
        } catch {
          return { kind: "unsupported", description: "유효한 UTF-8이 아닌 파일" };
        }
      } catch {
        return { kind: "unsupported", description: "안전하게 열 수 없는 파일" };
      } finally {
        await handle?.close();
      }
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
