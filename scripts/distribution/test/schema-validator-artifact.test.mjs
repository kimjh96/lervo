import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  schemaValidatorDigest,
  schemaValidatorSourceIdentity,
  verifySchemaValidatorArtifact,
} from "../../shared/schema-validator-artifact.mjs";
import { schemaValidatorCompilerOptions } from "../../shared/schema-validator-contract.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-schema-artifact-"));
  roots.push(root);
  const paths = [
    "pnpm-lock.yaml",
    "packages/schemas/package.json",
    "packages/schemas/src/schema-catalog.ts",
    "packages/schemas/scripts/compile-validators.mjs",
    "packages/schemas/scripts/primitive-enum-keyword.mjs",
    "packages/schemas/scripts/generate-validators.mjs",
    "scripts/shared/schema-validator-artifact.mjs",
    "scripts/shared/schema-validator-contract.mjs",
  ];
  for (const path of paths) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), "fixture input");
  }
  const directory = resolve(root, "packages/schemas/dist/generated");
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from("export default {};");
  const manifest = {
    schemaVersion: 1,
    generatorVersion: 2,
    ...(await schemaValidatorSourceIdentity(root)),
    schemaCount: 1,
    toolchain: { ajv: "8.0.0", esbuild: "0.28.2" },
    runtimeDependencies: [],
    compilerOptions: schemaValidatorCompilerOptions,
    contentHash: schemaValidatorDigest(bytes),
    byteLength: bytes.length,
  };
  await writeFile(resolve(directory, "validators.js"), bytes);
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify(manifest));
  return { root, directory, manifest };
}

it("accepts an exact pair and rejects changed schema or compiler inputs", async () => {
  const { root, manifest } = await fixture();
  expect(await verifySchemaValidatorArtifact(root)).toEqual(manifest);
  await writeFile(resolve(root, "packages/schemas/src/schema-catalog.ts"), "changed schema");
  await expect(verifySchemaValidatorArtifact(root)).rejects.toThrow(
    "schema_validator_artifact_stale",
  );
});

it("rejects changed output, missing files and linked output", async () => {
  const { root, directory } = await fixture();
  const path = resolve(directory, "validators.js");
  await writeFile(path, "changed output");
  await expect(verifySchemaValidatorArtifact(root)).rejects.toThrow(
    "schema_validator_artifact_stale",
  );
  await rm(path);
  await expect(verifySchemaValidatorArtifact(root)).rejects.toMatchObject({ code: "ENOENT" });
  await symlink(resolve(root, "pnpm-lock.yaml"), path);
  await expect(verifySchemaValidatorArtifact(root)).rejects.toThrow(
    "schema_validator_artifact_invalid",
  );
});

it("binds the enum compiler and rejects a prior generator manifest", async () => {
  const { root, directory, manifest } = await fixture();
  await writeFile(
    resolve(directory, "manifest.json"),
    JSON.stringify({ ...manifest, generatorVersion: 1 }),
  );
  await expect(verifySchemaValidatorArtifact(root)).rejects.toThrow(
    "schema_validator_artifact_stale",
  );
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify(manifest));
  await writeFile(resolve(root, "packages/schemas/scripts/primitive-enum-keyword.mjs"), "changed");
  await expect(verifySchemaValidatorArtifact(root)).rejects.toThrow(
    "schema_validator_artifact_stale",
  );
});

it("rejects changed validation options or input coordinates", async () => {
  const { root, directory, manifest } = await fixture();
  const path = resolve(directory, "manifest.json");
  await writeFile(path, JSON.stringify({ ...manifest, compilerOptions: { allErrors: false } }));
  await expect(verifySchemaValidatorArtifact(root)).rejects.toThrow(
    "schema_validator_artifact_stale",
  );
  await writeFile(path, JSON.stringify({ ...manifest, inputs: [] }));
  await expect(verifySchemaValidatorArtifact(root)).rejects.toThrow(
    "schema_validator_artifact_stale",
  );
});
