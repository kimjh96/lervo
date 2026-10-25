import { nodeRuntimesDirectory } from "./managed-node-runtime-paths.js";
import { lstat, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Bind a running bundle's physical directory before a stable `current` link can move. */
export async function bindInstalledRuntimeProcess(
  executable: string,
  options: {
    homeDirectory?: string;
    platform?: NodeJS.Platform;
    processIdentity?: () => string | null;
  } = {},
): Promise<() => Promise<void>> {
  const physical = await realpath(executable);
  const runtime = dirname(physical);
  const root = nodeRuntimesDirectory(options.homeDirectory, options.platform);
  const matchesRoot =
    dirname(runtime) === root ||
    ((options.platform ?? process.platform) === "darwin" &&
      dirname(runtime).toLowerCase() === root.toLowerCase());
  if (
    !matchesRoot ||
    basename(physical) !== "node-runtime.js" ||
    !/^[a-f0-9]{16}$/u.test(basename(runtime)) ||
    basename(dirname(runtime)) !== "node"
  )
    return async () => {};
  const processIdentity = options.processIdentity?.();
  if (
    typeof processIdentity !== "string" ||
    !/^proc_[a-z0-9_]{1,64}:sha256:[a-f0-9]{64}$/u.test(processIdentity)
  )
    throw new Error("Runtime process birth identity is unavailable.");
  const directory = resolve(runtime, ".processes");
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Unsafe runtime process binding directory.");
  const entries = await readdir(directory);
  if (entries.length > 256) throw new Error("Runtime process binding capacity exceeded.");
  for (const entry of entries) {
    if (!/^[1-9][0-9]*\.json$/u.test(entry)) throw new Error("Invalid runtime process binding.");
    const pid = Number(entry.slice(0, -5));
    if (!running(pid)) await rm(resolve(directory, entry));
  }
  if ((await readdir(directory)).length >= 256)
    throw new Error("Runtime process binding capacity exceeded.");
  const path = resolve(directory, `${process.pid}.json`);
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      processId: process.pid,
      processIdentity,
      runtimeDirectory: basename(runtime),
    }),
    { mode: 0o600, flag: "wx" },
  );
  return async () => {
    await rm(path, { force: true });
  };
}
