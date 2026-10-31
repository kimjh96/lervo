import { homedir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { safeOptionalText } from "./terminal-integration-files.js";
import { verifyTerminalHookRuntimeArtifact } from "./terminal-runtime-integrity.js";
import { lstat, realpath } from "node:fs/promises";

/** POSIX trust is separate from byte integrity. Windows ACL validation remains deferred. */
export async function assertPrivateTerminalRuntimePath(
  path: string,
  kind: "file" | "directory",
): Promise<void> {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    (kind === "file" ? !stat.isFile() : !stat.isDirectory()) ||
    (process.platform !== "win32" && (stat.uid !== process.getuid!() || (stat.mode & 0o022) !== 0))
  )
    throw new Error("Unsafe terminal runtime store.");
}

/** Accept only byte-verified artifacts that the launcher can trust on this host. */
export async function verifyPrivateTerminalRuntimeArtifact(root: string): Promise<boolean> {
  try {
    await assertPrivateTerminalRuntimePath(root, "directory");
    if (!(await verifyTerminalHookRuntimeArtifact(resolve(root, "runtime-v2.mjs")))) return false;
    for (const name of ["runtime-v2.mjs", "runtime-v2.json"])
      await assertPrivateTerminalRuntimePath(resolve(root, name), "file");
    const manifest = JSON.parse(
      (await safeOptionalText(resolve(root, "runtime-v2.json")))!.content,
    );
    if (manifest.assets.length)
      await assertPrivateTerminalRuntimePath(resolve(root, "native"), "directory");
    for (const asset of manifest.assets)
      await assertPrivateTerminalRuntimePath(resolve(root, asset.path), "file");
    return true;
  } catch {
    return false;
  }
}

/** Explicit non-default stores are caller-owned; the default host path must stay inside home. */
export async function assertHostTerminalRuntimeParents(store: string): Promise<void> {
  const home = homedir();
  if (process.platform === "win32" || resolve(store) !== resolve(home, ".lervo/terminal-hooks"))
    return;
  let parent: string;
  try {
    parent = await realpath(dirname(store));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const within = relative(await realpath(home), parent);
  if (within === ".." || within.startsWith(`..${sep}`) || within.startsWith(sep))
    throw new Error("Unsafe terminal runtime store parent.");
}
