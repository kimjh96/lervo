import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, "../../..");

// A clean schema build typechecks twice and compiles every validator; shared two-core CI runners
// take about 90 s for work that finishes in about 12 s on a developer machine.
it("typechecks and builds without existing outputs and reproduces the validator bytes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-schema-clean-build-"));
  try {
    for (const path of [
      "pnpm-lock.yaml",
      "tsconfig.base.json",
      "packages/schemas/package.json",
      "packages/schemas/tsconfig.json",
      "packages/schemas/src",
      "packages/schemas/scripts",
      "scripts/shared/schema-validator-artifact.mjs",
      "scripts/shared/schema-validator-contract.mjs",
    ]) {
      await mkdir(resolve(root, path, ".."), { recursive: true });
      await cp(resolve(repository, path), resolve(root, path), { recursive: true });
    }
    for (const path of ["node_modules", "packages/schemas/node_modules"])
      await symlink(resolve(repository, path), resolve(root, path), "junction");
    const run = (args) => execute(process.execPath, args, { cwd: root, timeout: 120_000 });
    const tsc = resolve(repository, "node_modules/typescript/bin/tsc");
    await run([tsc, "--project", "packages/schemas/tsconfig.json", "--noEmit"]);
    await expect(
      readFile(resolve(root, "packages/schemas/dist/generated/validators.js")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const staging = resolve(root, "packages/schemas/dist/generated/.generation");
    await mkdir(staging, { recursive: true });
    await writeFile(resolve(staging, "retained"), "another generator owns this stage");
    await expect(run(["packages/schemas/scripts/generate-validators.mjs"])).rejects.toThrow(
      "EEXIST",
    );
    expect(await readFile(resolve(staging, "retained"), "utf8")).toBe(
      "another generator owns this stage",
    );
    await rm(staging, { recursive: true });
    await run(["packages/schemas/scripts/generate-validators.mjs"]);
    await expect(readFile(staging)).rejects.toMatchObject({ code: "ENOENT" });
    await run([tsc, "--project", "packages/schemas/tsconfig.json"]);
    const result = await run([
      "--disallow-code-generation-from-strings",
      "--input-type=module",
      "-e",
      'const {validateSchema}=await import("./packages/schemas/dist/index.js"); if(validateSchema("event",null).valid) throw new Error("invalid event accepted"); console.log("validated");',
    ]);
    expect(result.stdout.trim()).toBe("validated");
    for (const name of [
      "validators.js",
      "selected-validators.js",
      "coordinate-data-validators.js",
      "manifest.json",
    ]) {
      const path = `packages/schemas/dist/generated/${name}`;
      expect(await readFile(resolve(root, path))).toEqual(
        await readFile(resolve(repository, path)),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 300_000);
