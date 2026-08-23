import { prepareOwnerOnlyDatabasePath as prepareSecureDatabasePath } from "@lervo/runtime-security";

import { HubRuntimeError } from "./errors.js";

/** Ensures SQLite, WAL, and SHM files live below an owner-only real directory. */
export async function prepareOwnerOnlyDatabasePath(path: string): Promise<string> {
  try {
    return await prepareSecureDatabasePath(path);
  } catch (error) {
    throw new HubRuntimeError(
      "unsafe_runtime_file",
      "The Hub runtime database must be a regular file in an owner-only directory.",
      { cause: error },
    );
  }
}
