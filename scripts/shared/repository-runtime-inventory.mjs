import {
  isRuntimeModuleName,
  runtimeModuleHash,
  runtimeModuleManifest,
  runtimeModuleManifestMaximumBytes,
  runtimeModuleMaximumBytes,
  validateRuntimeModuleManifest,
} from "../../packages/runtime-security/dist/index.js";

/** Outer archive inventories must agree with the canonical inner graph manifest. */
export function repositoryRuntimeInventory(files) {
  if (!Array.isArray(files)) throw new Error("repository_runtime_inventory_invalid");
  const members = files.filter(
    (entry) => typeof entry?.path === "string" && entry.path.startsWith("dist/repository-runtime"),
  );
  const manifestEntry = members.find((entry) => entry.path === `dist/${runtimeModuleManifest}`);
  const graphFiles = members
    .filter((entry) => entry !== manifestEntry)
    .map((entry) => {
      const name = entry.path.slice(5);
      if (!isRuntimeModuleName(name) || (entry.kind !== undefined && entry.kind !== "file"))
        throw new Error("repository_runtime_inventory_invalid");
      return { name, size: entry.size, sha256: entry.sha256 };
    });
  const manifest = validateRuntimeModuleManifest({
    schemaVersion: 1,
    entry: "repository-runtime.js",
    files: graphFiles,
  });
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (
    !manifestEntry ||
    (manifestEntry.kind !== undefined && manifestEntry.kind !== "file") ||
    bytes.length > runtimeModuleManifestMaximumBytes ||
    manifestEntry.size !== bytes.length ||
    manifestEntry.sha256 !== runtimeModuleHash(bytes) ||
    bytes.length + graphFiles.reduce((sum, entry) => sum + entry.size, 0) >
      runtimeModuleMaximumBytes
  )
    throw new Error("repository_runtime_inventory_invalid");
  return { files: members, hash: manifestEntry.sha256 };
}
