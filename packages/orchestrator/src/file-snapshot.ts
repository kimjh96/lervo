import { createHash } from "node:crypto";

import { ContextPreparationError, readRepositoryFile } from "@lervo/context";

import { ManagedContextError } from "./types.js";

export async function readManagedFileHash(
  repositoryRoot: string,
  path: string,
): Promise<string | null> {
  try {
    const bytes = await readRepositoryFile(repositoryRoot, path);
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  } catch (error) {
    if (error instanceof ContextPreparationError && error.code === "document_missing") {
      return null;
    }
    throw new ManagedContextError(
      "file_snapshot_invalid",
      "변경 대상 파일의 현재 상태를 안전하게 확인하지 못했습니다.",
    );
  }
}
