import { lstat, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** A checkout build has its source entry beside dist; installed layouts have no source entry. */
export async function isInstalledTerminalRuntimeCli(entry: string): Promise<boolean> {
  const source = resolve(dirname(await realpath(entry)), "../src/bin.ts");
  try {
    return !(await lstat(source)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
