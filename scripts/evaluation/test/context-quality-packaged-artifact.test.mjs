import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { packagedArtifactHash } from "../lib/context-quality-packaged-artifact.mjs";
import { validateActiveProtocol } from "../lib/context-quality-active-runner.mjs";
import { activeWorker } from "../lib/context-quality-active-worker.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-packaged-identity-"));
  roots.push(root);
  await mkdir(resolve(root, "dist"));
  await mkdir(resolve(root, "node_modules/dependency"), { recursive: true });
  const files = ["dist/bin.js", "dist/node-runtime.js", "dist/repository-runtime.js"];
  await writeFile(resolve(root, "package.json"), JSON.stringify({ name: "@lervo/cli", files }));
  for (const entry of files)
    await writeFile(resolve(root, entry), 'import { run } from "./repository-runtime.js";\n');
  await writeFile(resolve(root, "node_modules/dependency/index.js"), "export const version = 1;");
  return { kind: "packed_cli", packageRoot: root };
}

it("binds installed module and transitive dependency bytes", async () => {
  const execution = await fixture();
  const before = await packagedArtifactHash(execution);
  await writeFile(resolve(execution.packageRoot, "node_modules/dependency/index.js"), "changed");
  expect(await packagedArtifactHash(execution)).not.toBe(before);
  const changed = await packagedArtifactHash(execution);
  await writeFile(resolve(execution.packageRoot, "dist/repository-runtime.js"), "changed module");
  expect(await packagedArtifactHash(execution)).not.toBe(changed);
});

it("rejects missing modules, standalone entrypoints and escaping dependencies", async () => {
  const execution = await fixture();
  const module = resolve(execution.packageRoot, "dist/repository-runtime.js");
  await rm(module);
  await expect(packagedArtifactHash(execution)).rejects.toThrow();
  await writeFile(module, "export const run = 1;");
  await writeFile(resolve(execution.packageRoot, "dist/bin.js"), "standalone");
  await expect(packagedArtifactHash(execution)).rejects.toThrow("Product entrypoint");
  await writeFile(
    resolve(execution.packageRoot, "dist/bin.js"),
    'import { run } from "./repository-runtime.js";',
  );
  await symlink(tmpdir(), resolve(execution.packageRoot, "node_modules/escape"));
  await expect(packagedArtifactHash(execution)).rejects.toThrow("escapes package root");
});

it("requires frozen gates and explicit packaged coordinates without source fallback", async () => {
  const protocol = JSON.parse(
    await readFile("benchmarks/context-quality/native-source-v1.json", "utf8"),
  );
  const execution = await fixture();
  expect(() => validateActiveProtocol({ ...protocol, execution })).toThrow();
  protocol.protocolId = "context-quality-packaged-resource-v1";
  protocol.execution = execution;
  expect(() => validateActiveProtocol(protocol)).not.toThrow();
  expect(() =>
    validateActiveProtocol({ ...protocol, execution: { ...execution, kind: "source" } }),
  ).toThrow();
  expect(() =>
    validateActiveProtocol({ ...protocol, execution: { ...execution, packageRoot: "." } }),
  ).toThrow();
  expect(() =>
    validateActiveProtocol({ ...protocol, gates: { ...protocol.gates, cpuRatioUpper95: 2 } }),
  ).toThrow();
  await rm(resolve(execution.packageRoot, "dist/repository-runtime.js"));
  await expect(
    activeWorker(execution.packageRoot, "control", "cold", 4096, protocol),
  ).rejects.toThrow();
});

it("requires complete graph identity when the package declares private chunk patterns", async () => {
  const execution = await fixture(),
    root = execution.packageRoot;
  const packagePath = resolve(root, "package.json"),
    manifest = JSON.parse(await readFile(packagePath, "utf8"));
  manifest.files.push(
    "dist/repository-runtime.json",
    "dist/repository-runtime-*.js",
    "dist/repository-runtime-*.cjs",
  );
  await writeFile(packagePath, JSON.stringify(manifest));
  const { runtimeModuleHash } = await import("../../../packages/runtime-security/dist/index.js");
  await writeFile(resolve(root, "dist/repository-runtime-fallback.cjs"), "module.exports = {};\n");
  const files = await Promise.all(
    ["repository-runtime-fallback.cjs", "repository-runtime.js"].map(async (name) => {
      const bytes = await readFile(resolve(root, "dist", name));
      return { name, size: bytes.length, sha256: runtimeModuleHash(bytes) };
    }),
  );
  await writeFile(
    resolve(root, "dist/repository-runtime.json"),
    JSON.stringify({ schemaVersion: 1, entry: "repository-runtime.js", files }, null, 2) + "\n",
  );
  expect(await packagedArtifactHash(execution)).toMatch(/^sha256:/);
  await writeFile(resolve(root, "dist/repository-runtime-fallback.cjs"), "changed");
  await expect(packagedArtifactHash(execution)).rejects.toThrow();
});
