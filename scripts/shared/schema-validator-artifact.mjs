import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { validSchemaValidatorManifest } from "./schema-validator-contract.mjs";

export const schemaValidatorDigest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Bind the complete schema source catalog, generator and locked compiler inputs. */
export async function schemaValidatorSourceIdentity(repositoryRoot) {
  const paths = [
    "pnpm-lock.yaml",
    "packages/schemas/package.json",
    "packages/schemas/scripts/compile-validators.mjs",
    "packages/schemas/scripts/generate-validators.mjs",
    "scripts/shared/schema-validator-artifact.mjs",
    "scripts/shared/schema-validator-contract.mjs",
  ];
  async function visit(path) {
    for (const entry of await readdir(resolve(repositoryRoot, path), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("schema_validator_source_invalid");
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.endsWith(".ts")) paths.push(child);
      if (paths.length > 1024) throw new Error("schema_validator_source_limit");
    }
  }
  await visit("packages/schemas/src");
  const inputs = await Promise.all(
    paths
      .sort()
      .map(async (path) => [
        path,
        schemaValidatorDigest(await readFile(resolve(repositoryRoot, path))),
      ]),
  );
  return { inputs, sourceHash: schemaValidatorDigest(JSON.stringify(inputs)) };
}

async function artifactFile(path, maximumBytes) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes)
    throw new Error("schema_validator_artifact_invalid");
  const bytes = await readFile(path);
  if (bytes.length > maximumBytes) throw new Error("schema_validator_artifact_invalid");
  return bytes;
}

export async function verifySchemaValidatorArtifact(
  repositoryRoot,
  directory = resolve(repositoryRoot, "packages/schemas/dist/generated"),
) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("schema_validator_artifact_invalid");
  const identity = await schemaValidatorSourceIdentity(repositoryRoot);
  const manifest = JSON.parse(
    (await artifactFile(resolve(directory, "manifest.json"), 262144)).toString("utf8"),
  );
  const bytes = await artifactFile(resolve(directory, "validators.js"), 16 * 1024 * 1024);
  if (
    !validSchemaValidatorManifest(manifest) ||
    manifest.sourceHash !== identity.sourceHash ||
    JSON.stringify(manifest.inputs) !== JSON.stringify(identity.inputs) ||
    manifest.contentHash !== schemaValidatorDigest(bytes) ||
    manifest.byteLength !== bytes.length
  )
    throw new Error("schema_validator_artifact_stale");
  return manifest;
}
