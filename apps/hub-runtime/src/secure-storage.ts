import { prepareOwnerOnlyDatabasePath as prepareSecureDatabasePath } from "@lervo/runtime-security";

import { HubRuntimeError } from "./errors.js";

/** Ensures SQLite, WAL, and SHM files live below an owner-only real directory. */
export async function prepareOwnerOnlyDatabasePath(path: string): Promise<string> {
  try {
    return await prepareSecureDatabasePath(path);
  } catch (error) {
    throw new HubRuntimeError(
      "unsafe_runtime_file",
      "Hub runtime database는 owner-only 디렉터리의 일반 파일이어야 합니다.",
      { cause: error },
    );
  }
}
