import { lstat, realpath } from "node:fs/promises";

/** A case-insensitive Mac volume may preserve an older spelling of the Lervo directory. */
export async function assertRealRuntimeRoot(
  root: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const info = await lstat(root);
  const physical = await realpath(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (physical !== root && (platform !== "darwin" || physical.toLowerCase() !== root.toLowerCase()))
  )
    throw new Error("Runtime retention requires a real runtime root.");
}
