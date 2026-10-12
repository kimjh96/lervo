import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  readRuntimeModuleArtifact,
  validateRuntimeModuleArtifact,
} from "../src/runtime-module-artifact.js";
import { publishRuntimeModuleArtifact } from "../src/runtime-module-publication.js";
import {
  runtimeModuleHash,
  validateRuntimeModuleManifest,
} from "../src/runtime-module-contract.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-graph-"));
  roots.push(root);
  const source = resolve(root, "source"),
    target = resolve(root, "target");
  await mkdir(source);
  await mkdir(target);
  const bodies = new Map([
    ["repository-runtime.js", 'export { value } from "./repository-runtime-core.js";\n'],
    ["repository-runtime-core.js", "export const value = 42;\n"],
    ["repository-runtime-fallback.cjs", "module.exports = { valid: true };\n"],
  ]);
  const files = [...bodies]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, text]) => ({
      name,
      size: Buffer.byteLength(text),
      sha256: runtimeModuleHash(text),
    }));
  const manifest = { schemaVersion: 1, entry: "repository-runtime.js", files };
  for (const [name, text] of bodies) await writeFile(resolve(source, name), text);
  await writeFile(
    resolve(source, "repository-runtime.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return { source, target, manifest, snapshot: await readRuntimeModuleArtifact(source) };
}

it("captures and repairs the complete graph without reopening the admitted source", async () => {
  const { source, target, snapshot } = await fixture();
  await writeFile(resolve(source, "repository-runtime-core.js"), "source changed");
  await publishRuntimeModuleArtifact(target, snapshot);
  expect((await readRuntimeModuleArtifact(target)).hash).toBe(snapshot.hash);
  for (const name of snapshot.files.keys()) {
    await rm(resolve(target, name));
    await publishRuntimeModuleArtifact(target, snapshot);
    expect(await readFile(resolve(target, name))).toEqual(snapshot.files.get(name));
  }
});

it.each([
  "repository-runtime.js",
  "repository-runtime-core.js",
  "repository-runtime-fallback.cjs",
  "repository-runtime.json",
])("rejects changed or missing %s", async (name) => {
  const { source } = await fixture();
  await writeFile(resolve(source, name), "changed");
  await expect(readRuntimeModuleArtifact(source)).rejects.toThrow();
  await rm(resolve(source, name));
  await expect(readRuntimeModuleArtifact(source)).rejects.toThrow();
});

it("checks every conflict before publishing a missing member and preserves owner bytes", async () => {
  const { target, snapshot } = await fixture();
  await writeFile(resolve(target, "repository-runtime-fallback.cjs"), "owner bytes");
  await expect(publishRuntimeModuleArtifact(target, snapshot)).rejects.toThrow();
  expect(await readdir(target)).toEqual(["repository-runtime-fallback.cjs"]);
  expect(await readFile(resolve(target, "repository-runtime-fallback.cjs"), "utf8")).toBe(
    "owner bytes",
  );
});

it("rejects changed snapshot bytes and extra namespace members", async () => {
  const { source, target, snapshot } = await fixture();
  snapshot.files.get("repository-runtime-core.js")![0] = 0;
  expect(() => validateRuntimeModuleArtifact(snapshot)).toThrow();
  await expect(publishRuntimeModuleArtifact(target, snapshot)).rejects.toThrow();
  expect(await readdir(target)).toEqual([]);
  await writeFile(resolve(source, "repository-runtime-surprise.js"), "unlisted");
  await expect(readRuntimeModuleArtifact(source)).rejects.toThrow("inventory_invalid");
});

it("rejects linked member and directory observations without altering their targets", async () => {
  const { source, target, snapshot } = await fixture();
  await symlink(
    resolve(source, "repository-runtime-core.js"),
    resolve(target, "repository-runtime-core.js"),
  );
  await expect(publishRuntimeModuleArtifact(target, snapshot)).rejects.toThrow();
  expect(await readFile(resolve(source, "repository-runtime-core.js"))).toEqual(
    snapshot.files.get("repository-runtime-core.js"),
  );
  const linked = resolve(target, "linked");
  await symlink(source, linked);
  await expect(readRuntimeModuleArtifact(linked)).rejects.toThrow("directory_invalid");
});

it("rejects oversized files before reading and bounds aggregate sizes and cardinality", async () => {
  const { source, manifest } = await fixture();
  await truncate(resolve(source, "repository-runtime-core.js"), 64 * 1024 * 1024 + 1);
  await expect(readRuntimeModuleArtifact(source)).rejects.toThrow("file_invalid");
  for (const invalid of [
    { ...manifest, files: manifest.files.map((file) => ({ ...file, size: 32 * 1024 * 1024 })) },
    { ...manifest, files: Array(129).fill(manifest.files[0]) },
    {
      ...manifest,
      files: [
        ...manifest.files,
        { ...manifest.files[0]!, name: "repository-runtime-Core.js" },
      ].sort((a, b) => (a.name < b.name ? -1 : 1)),
    },
    { ...manifest, files: manifest.files.filter((file) => file.name !== "repository-runtime.js") },
    { ...manifest, files: [...manifest.files].reverse() },
    {
      ...manifest,
      files: [{ ...manifest.files[0], name: "../escape.js" }, ...manifest.files.slice(1)],
    },
  ])
    expect(() => validateRuntimeModuleManifest(invalid)).toThrow();
});

it("owns publication bytes before asynchronous destination work", async () => {
  const { source, target, snapshot } = await fixture();
  const original = await readFile(resolve(source, "repository-runtime-core.js"));
  const publishing = publishRuntimeModuleArtifact(target, snapshot);
  snapshot.files.get("repository-runtime-core.js")![0] = 0;
  await publishing;
  expect(await readFile(resolve(target, "repository-runtime-core.js"))).toEqual(original);
});
