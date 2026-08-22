import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { SourceTreeScanError } from "./source-scan.js";

export async function readStableUtf8File(path: string, maximumBytes: number): Promise<string> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maximumBytes)) {
    throw new SourceTreeScanError("source_unsafe", "검사할 metadata 파일이 안전한 크기의 일반 파일이 아닙니다.");
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (before.dev !== opened.dev || before.ino !== opened.ino) {
      throw new SourceTreeScanError("source_changed", "metadata 파일이 열기 전에 바뀌었습니다.");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new SourceTreeScanError("source_changed", "metadata 파일이 읽는 동안 바뀌었습니다.");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SourceTreeScanError("source_unsafe", "metadata 파일이 유효한 UTF-8이 아닙니다.");
    }
  } finally {
    await handle.close();
  }
}
