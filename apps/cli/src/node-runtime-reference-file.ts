import { lstat, readFile } from "node:fs/promises";

export async function readRuntimeReferenceText(path: string): Promise<string | null> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info === null) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024)
    throw new Error("Runtime retention cannot inspect a service reference.");
  return readFile(path, "utf8");
}
