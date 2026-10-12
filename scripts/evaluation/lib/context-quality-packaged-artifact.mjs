import { readRuntimeModuleArtifact } from "../../../packages/runtime-security/dist/index.js";
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { digest } from "./context-quality-artifact-identity.mjs";

export function validatePackagedExecution(execution) {
  if (
    execution?.kind !== "packed_cli" ||
    typeof execution.packageRoot !== "string" ||
    !isAbsolute(execution.packageRoot) ||
    Object.keys(execution).sort().join(",") !== "kind,packageRoot"
  )
    throw new Error("Invalid packaged execution coordinates.");
}

/** Bind the complete installed package, including its local production dependency closure. */
export async function packagedArtifactHash(execution) {
  validatePackagedExecution(execution);
  const root = await realpath(execution.packageRoot);
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (
    manifest.name !== "@lervo/cli" ||
    !Array.isArray(manifest.files) ||
    !manifest.files.includes("dist/repository-runtime.js") ||
    manifest.files.some(
      (path) =>
        typeof path !== "string" || isAbsolute(path) || path.includes("..") || path.includes("\\"),
    )
  )
    throw new Error("Unsupported installed CLI composition.");
  const graphPatterns = new Set(["dist/repository-runtime-*.js", "dist/repository-runtime-*.cjs"]);
  if (
    manifest.files.some((path) => graphPatterns.has(path)) &&
    !manifest.files.includes("dist/repository-runtime.json")
  )
    throw new Error("Missing packaged runtime inventory.");
  if (manifest.files.includes("dist/repository-runtime.json"))
    await readRuntimeModuleArtifact(resolve(root, "dist"));
  for (const path of [
    ...manifest.files.filter((path) => !graphPatterns.has(path)),
    "package.json",
  ]) {
    const info = await lstat(resolve(root, path));
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0)
      throw new Error("Missing or redirected packaged file.");
  }
  for (const name of ["bin.js", "node-runtime.js"]) {
    const entry = await readFile(resolve(root, "dist", name), "utf8");
    if (!entry.includes('from "./repository-runtime.js"'))
      throw new Error("Product entrypoint does not consume the shared runtime.");
  }
  const entries = [];
  let totalBytes = 0;
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = resolve(directory, name),
        info = await lstat(path);
      if (entries.length >= 100000) throw new Error("Installed artifact exceeds file bound.");
      const key = relative(root, path).split(sep).join("/");
      if (info.isSymbolicLink()) {
        const target = await realpath(path);
        if (!target.startsWith(root + sep))
          throw new Error("Installed dependency escapes package root.");
        entries.push([key, "symlink", await readlink(path)]);
      } else if (info.isDirectory()) await visit(path);
      else if (info.isFile()) {
        totalBytes += info.size;
        if (totalBytes > 1024 * 1024 * 1024)
          throw new Error("Installed artifact exceeds byte bound.");
        entries.push([key, "file", info.size, digest(await readFile(path))]);
      } else throw new Error("Unsupported installed artifact entry.");
    }
  }
  await visit(root);
  if (!entries.some((entry) => entry[0].startsWith("node_modules/")))
    throw new Error("The installed production dependencies are missing.");
  return digest(JSON.stringify(entries));
}
