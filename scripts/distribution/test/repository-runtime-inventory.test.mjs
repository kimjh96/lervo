import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { writeRepositoryRuntimeInventory } from "../lib/repository-runtime-inventory.mjs";
import { repositoryRuntimeInventory } from "../../shared/repository-runtime-inventory.mjs";
import {
  publishRuntimeModuleArtifact,
  runtimeModuleHash,
} from "../../../packages/runtime-security/dist/index.js";
import { createNodeDistributionSbom } from "../lib/runtime-distribution-sbom.mjs";
import { validateRepositoryRuntimeSbom } from "../../shared/repository-runtime-contract.mjs";
const { build } = createRequire(new URL("../../../apps/cli/package.json", import.meta.url))(
  "esbuild",
);
const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("captures every real split output, relocates it, and binds one complete SBOM component", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-inventory-"));
  roots.push(root);
  const output = resolve(root, "dist"),
    target = resolve(root, "installed");
  await mkdir(output);
  await mkdir(target);
  await writeFile(resolve(root, "shared.js"), "export const state = { value: 42 };\n");
  await writeFile(
    resolve(root, "entry.js"),
    'export { state } from "./shared.js"; export const load = () => import("./fallback.js");\n',
  );
  await writeFile(resolve(root, "fallback.js"), 'export { state } from "./shared.js";\n');
  const result = await build({
    absWorkingDir: root,
    entryPoints: { "repository-runtime": "entry.js", "repository-runtime-fallback": "fallback.js" },
    outdir: output,
    bundle: true,
    splitting: true,
    format: "esm",
    chunkNames: "repository-runtime-[hash]",
    metafile: true,
    logLevel: "silent",
  });
  const captured = await writeRepositoryRuntimeInventory(
    root,
    output,
    result.metafile,
    async () => {},
  );
  expect(captured.files.size).toBe(4);
  await publishRuntimeModuleArtifact(target, captured);
  await writeFile(resolve(target, "package.json"), '{"type":"module"}');
  const entry = await import(pathToFileURL(resolve(target, "repository-runtime.js")).href);
  expect(entry.state.value).toBe(42);
  expect((await entry.load()).state).toBe(entry.state);
  const outer = [...captured.files]
    .map(([name, bytes]) => ({
      path: `dist/${name}`,
      size: bytes.length,
      sha256: runtimeModuleHash(bytes),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  expect(repositoryRuntimeInventory(outer).hash).toBe(captured.hash);
  const sbom = createNodeDistributionSbom(
    "0.1.0",
    [],
    runtimeModuleHash("entry"),
    undefined,
    captured.hash,
    "inventory",
  );
  expect(() => validateRepositoryRuntimeSbom(sbom, captured.hash, "inventory")).not.toThrow();
  expect(() =>
    validateRepositoryRuntimeSbom(
      sbom,
      runtimeModuleHash(captured.files.get("repository-runtime.js")),
    ),
  ).toThrow();
  const changed = structuredClone(outer);
  changed[0].sha256 = runtimeModuleHash("changed");
  expect(() => repositoryRuntimeInventory(changed)).toThrow();
  expect(sbom.components.filter((c) => c["bom-ref"] === "lervo:repository-runtime")).toHaveLength(
    1,
  );
  expect(await readFile(resolve(target, "repository-runtime.json"))).toEqual(
    captured.files.get("repository-runtime.json"),
  );
});

it("refuses a missing output dependency before publishing an inventory", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-dependency-"));
  roots.push(root);
  await writeFile(
    resolve(root, "repository-runtime.js"),
    'import "./repository-runtime-missing.js";',
  );
  await expect(
    writeRepositoryRuntimeInventory(
      root,
      root,
      {
        outputs: {
          "repository-runtime.js": {
            imports: [{ path: "./repository-runtime-missing.js", external: true }],
          },
        },
      },
      async () => {},
    ),
  ).rejects.toThrow("dependency_missing");
  await expect(readFile(resolve(root, "repository-runtime.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
