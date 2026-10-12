import { isBuiltinModuleSpecifier } from "../../shared/node-module-specifier.mjs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  isRuntimeModuleName,
  readRuntimeModuleArtifact,
  readRuntimeModuleFile,
  runtimeModuleMaximumBytes,
  runtimeModuleMaximumFiles,
  runtimeModuleEntry,
  runtimeModuleHash,
  runtimeModuleManifest,
  validateRuntimeModuleManifest,
} from "../../../packages/runtime-security/dist/index.js";

/** Bind all outputs from the runtime build, not only the public loader's bytes. */
export async function writeRepositoryRuntimeInventory(
  repositoryRoot,
  outputDirectory,
  metafile,
  normalizeGeneratedTextFile,
) {
  if (typeof normalizeGeneratedTextFile !== "function")
    throw new Error("repository_runtime_normalizer_missing");
  const outputs = new Set(
    Object.keys(metafile.outputs).map((path) => resolve(repositoryRoot, path)),
  );
  if (outputs.size < 1 || outputs.size > runtimeModuleMaximumFiles)
    throw new Error("repository_runtime_output_invalid");
  let remaining = runtimeModuleMaximumBytes;
  for (const [path, output] of Object.entries(metafile.outputs)) {
    for (const dependency of output.imports) {
      if (
        dependency.external &&
        (isBuiltinModuleSpecifier(dependency.path) ||
          dependency.path === "@anthropic-ai/claude-agent-sdk")
      )
        continue;
      const target = dependency.external
        ? resolve(dirname(resolve(repositoryRoot, path)), dependency.path)
        : resolve(repositoryRoot, dependency.path);
      if (!outputs.has(target)) throw new Error("repository_runtime_dependency_missing");
    }
  }
  const files = [];
  for (const path of Object.keys(metafile.outputs).sort()) {
    const absolute = resolve(repositoryRoot, path),
      name = basename(absolute);
    if (dirname(absolute) !== resolve(outputDirectory) || !isRuntimeModuleName(name))
      throw new Error("repository_runtime_output_invalid");
    await normalizeGeneratedTextFile(absolute);
    const bytes = await readRuntimeModuleFile(absolute, remaining);
    remaining -= bytes.length;
    files.push({ name, size: bytes.length, sha256: runtimeModuleHash(bytes) });
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const manifest = validateRuntimeModuleManifest({
    schemaVersion: 1,
    entry: runtimeModuleEntry,
    files,
  });
  await writeFile(
    resolve(outputDirectory, runtimeModuleManifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return readRuntimeModuleArtifact(outputDirectory);
}
