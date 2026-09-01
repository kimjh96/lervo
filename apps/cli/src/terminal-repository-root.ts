import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function resolveTerminalRepositoryRoot(start: string): Promise<string> {
  let current = resolve(start);
  while (true) {
    try {
      const manifest = await lstat(resolve(current, ".lervo/project.yaml"));
      if (manifest.isFile() && !manifest.isSymbolicLink()) return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current)
      throw new Error("No initialized Lervo repository contains the hook working directory.");
    current = parent;
  }
}
