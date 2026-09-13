import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { operatingContractHash } from "@lervo/work-controller";

/** Read-only host-process access evidence; never grants worker or provider permissions. */
export async function inspectSupervisionPathAccess(
  workspacePath: string,
  expectedPaths: readonly string[],
  mode: "read" | "write",
): Promise<string> {
  if (
    !isAbsolute(workspacePath) ||
    expectedPaths.length === 0 ||
    expectedPaths.length > 32 ||
    expectedPaths.some(
      (path) =>
        path.length > 4096 ||
        !/^[^\\\0:*?[\]{}]+$/u.test(path) ||
        isAbsolute(path) ||
        path.split("/").length > 32 ||
        path.split("/").some((part) => part === "" || part === "." || part === ".."),
    )
  )
    throw new Error("Unsupported filesystem access scope.");
  const root = await realpath(workspacePath);
  if ((await lstat(workspacePath)).isSymbolicLink())
    throw new Error("Unsupported workspace alias.");
  const observations = new Map<string, string>();
  const inspect = async (path: string) => {
    const stat = await lstat(path);
    if (
      (!stat.isDirectory() && !stat.isFile()) ||
      (stat.isFile() && stat.nlink !== 1) ||
      (await realpath(path)) !== path
    )
      throw new Error("Unsupported filesystem entry.");
    const identity = operatingContractHash({
      device: stat.dev,
      inode: stat.ino,
      mode: stat.mode,
      owner: stat.uid,
      group: stat.gid,
      changedAt: stat.ctimeMs,
      links: stat.nlink,
    });
    const previous = observations.get(path);
    if (previous !== undefined && previous !== identity)
      throw new Error("Filesystem access source changed.");
    observations.set(path, identity);
    return stat;
  };
  if (!(await inspect(root)).isDirectory()) throw new Error("Workspace is not a directory.");
  await access(root, constants.X_OK);
  for (const scope of expectedPaths) {
    let current = root;
    const parts = scope.split("/");
    for (const [index, part] of parts.entries()) {
      const path = resolve(current, part);
      let stat;
      try {
        stat = await inspect(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // An absent target has only ancestor access evidence, never target access evidence.
        await access(
          current,
          constants.R_OK | constants.X_OK | (mode === "write" ? constants.W_OK : 0),
        );
        observations.set(path, "absent");
        break;
      }
      if (index < parts.length - 1) {
        if (!stat.isDirectory()) throw new Error("Scope ancestor is not a directory.");
        await access(path, constants.X_OK);
      } else {
        await access(
          path,
          (mode === "read" ? constants.R_OK : constants.W_OK) |
            (stat.isDirectory() ? constants.X_OK : 0),
        );
        if (mode === "write") await access(dirname(path), constants.W_OK | constants.X_OK);
      }
      current = path;
    }
  }
  for (const [path, identity] of observations) {
    if (identity !== "absent") await inspect(path);
    else {
      try {
        await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      throw new Error("Filesystem access source changed.");
    }
  }
  if ((await realpath(workspacePath)) !== root) throw new Error("Workspace access source changed.");
  return operatingContractHash({ root, expectedPaths, mode, observations: [...observations] });
}
