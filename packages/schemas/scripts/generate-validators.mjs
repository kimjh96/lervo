import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSchemaValidators } from "./compile-validators.mjs";
import { schemaValidatorCompilerOptions } from "../../../scripts/shared/schema-validator-contract.mjs";
import {
  schemaValidatorDigest,
  schemaValidatorSourceIdentity,
  verifySchemaValidatorArtifact,
} from "../../../scripts/shared/schema-validator-artifact.mjs";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");

async function generatePair(directory, staging) {
  const identity = await schemaValidatorSourceIdentity(repositoryRoot);
  const compiled = await compileSchemaValidators(packageRoot);
  if (compiled.bytes.length > 16 * 1024 * 1024) throw new Error("schema_validator_artifact_limit");
  const manifest = {
    schemaVersion: 1,
    generatorVersion: 1,
    ...identity,
    schemaCount: compiled.schemaCount,
    toolchain: compiled.toolchain,
    runtimeDependencies: compiled.runtimeDependencies,
    compilerOptions: schemaValidatorCompilerOptions,
    contentHash: schemaValidatorDigest(compiled.bytes),
    byteLength: compiled.bytes.length,
  };
  // A stale or interrupted pair fails verification; a later generation replaces these fixed names.
  const outputs = [
    ["validators.js", compiled.bytes],
    ["manifest.json", `${JSON.stringify(manifest, null, 2)}\n`],
  ];
  for (const [name, bytes] of outputs)
    await writeFile(resolve(staging, name), bytes, { flag: "wx" });
  for (const [name] of outputs) await rename(resolve(staging, name), resolve(directory, name));
  await verifySchemaValidatorArtifact(repositoryRoot);
  return manifest;
}

export async function generateSchemaValidators() {
  const directory = resolve(packageRoot, "dist/generated");
  for (const path of [resolve(packageRoot, "dist"), directory]) {
    await mkdir(path, { recursive: true });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("schema_validator_artifact_invalid");
  }
  const staging = resolve(directory, ".generation");
  // One exclusive directory owns the entire pair, including cleanup after either rename.
  await mkdir(staging);
  try {
    return await generatePair(directory, staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// Vitest runs this once before importing source modules that use the generated validators.
export default async function setup() {
  try {
    await verifySchemaValidatorArtifact(repositoryRoot);
  } catch {
    await generateSchemaValidators();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await generateSchemaValidators();
  process.stdout.write(
    `Generated ${manifest.schemaCount} schema validators (${manifest.byteLength} bytes).\n`,
  );
}
