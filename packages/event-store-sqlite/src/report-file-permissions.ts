import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { EventStoreError } from "./errors.js";

/** Raw report bytes in the database and its live journals retain the CAS owner-only boundary. */
export async function protectReportFiles(path: string, mode: "secure" | "verify"): Promise<void> {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const file = path + suffix;
    try {
      const observed = await lstat(file);
      if (!observed.isFile() || observed.isSymbolicLink()) throw new Error("Invalid report file.");
      if (mode === "verify") {
        if (process.platform !== "win32" && (observed.mode & 0o077) !== 0)
          throw new Error("Report file permissions are not private.");
        continue;
      }
      const handle = await open(
        file,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      );
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.dev !== observed.dev || current.ino !== observed.ino)
          throw new Error("Report file identity changed.");
        await handle.chmod(0o600);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (suffix !== "" && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new EventStoreError(
        "integrity_failed",
        "The report storage files are not private regular files.",
        { cause: error },
      );
    }
  }
}
