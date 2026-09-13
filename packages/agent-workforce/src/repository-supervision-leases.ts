import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { SQLiteSupervisionOwnerLeaseStore } from "./supervision-owner-lease.js";

export async function openRepositorySupervisionLeases(
  root: string,
): Promise<SQLiteSupervisionOwnerLeaseStore> {
  const home = await resolveRepositoryCoordinationHome(root);
  const path = resolve(home.workforce, "supervision-leases.sqlite");
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (process.platform !== "win32" &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw new Error("The repository supervision lease file is unsafe.");
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = await lstat(`${path}${suffix}`).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (
        sidecar !== null &&
        (!sidecar.isFile() ||
          sidecar.isSymbolicLink() ||
          sidecar.nlink !== 1 ||
          (process.platform !== "win32" &&
            ((sidecar.mode & 0o077) !== 0 || sidecar.uid !== process.getuid?.())))
      )
        throw new Error("A repository supervision lease sidecar is unsafe.");
    }
    return SQLiteSupervisionOwnerLeaseStore.open(path);
  } finally {
    await handle.close();
  }
}
