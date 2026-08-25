import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { SourceTreeScanError } from "./source-scan.js";

export async function readStableUtf8File(path: string, maximumBytes: number): Promise<string> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maximumBytes)) {
    throw new SourceTreeScanError(
      "source_unsafe",
      "The metadata file to inspect is not a safely sized regular file.",
    );
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (before.dev !== opened.dev || before.ino !== opened.ino) {
      throw new SourceTreeScanError(
        "source_changed",
        "The metadata file changed before it was opened.",
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new SourceTreeScanError(
        "source_changed",
        "The metadata file changed while it was being read.",
      );
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SourceTreeScanError("source_unsafe", "The metadata file is not valid UTF-8.");
    }
  } finally {
    await handle.close();
  }
}
