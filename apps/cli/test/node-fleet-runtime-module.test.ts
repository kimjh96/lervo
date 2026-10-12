import { runtimeModuleHash } from "@lervo/runtime-security";
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  inspectNodeRuntimeModule,
  materializeNodeRuntimeModule,
  readNodeRuntimeModule,
} from "../src/node-fleet-runtime-module.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-module-"));
  roots.push(root);
  const source = resolve(root, "source"),
    target = resolve(root, "target");
  await Promise.all([mkdir(source), mkdir(target)]);
  await writeFile(resolve(source, "repository-runtime.js"), "export const identity = 1;\n");
  const bytes = await readFile(resolve(source, "repository-runtime.js"));
  await writeFile(
    resolve(source, "repository-runtime.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        entry: "repository-runtime.js",
        files: [
          { name: "repository-runtime.js", size: bytes.length, sha256: runtimeModuleHash(bytes) },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  return { source, target, snapshot: await readNodeRuntimeModule(source) };
}

it("materializes the admitted module, detects deletion and repairs missing bytes", async () => {
  const { source, target, snapshot } = await fixture();
  await writeFile(resolve(source, "repository-runtime.js"), "changed after admission");
  expect(await inspectNodeRuntimeModule(target, snapshot)).toBe("missing");
  await materializeNodeRuntimeModule(target, snapshot);
  await materializeNodeRuntimeModule(target, snapshot);
  expect(await inspectNodeRuntimeModule(target, snapshot)).toBe("current");
  expect(await readFile(resolve(target, "repository-runtime.js"))).toEqual(
    snapshot.files.get("repository-runtime.js"),
  );
  await rm(resolve(target, "repository-runtime.js"));
  await materializeNodeRuntimeModule(target, snapshot);
  expect(await inspectNodeRuntimeModule(target, snapshot)).toBe("current");
});

it("retains conflicting installed bytes and rejects changed admitted bytes", async () => {
  const { target, snapshot } = await fixture();
  await writeFile(resolve(target, "repository-runtime.js"), "owner bytes");
  expect(await inspectNodeRuntimeModule(target, snapshot)).toBe("conflict");
  await expect(materializeNodeRuntimeModule(target, snapshot)).rejects.toThrow();
  expect(await readFile(resolve(target, "repository-runtime.js"), "utf8")).toBe("owner bytes");
  snapshot.files.get("repository-runtime.js")![0] = 0;
  await expect(materializeNodeRuntimeModule(target, snapshot)).rejects.toThrow();
});

it("rejects a redirected installed module even when target bytes match", async () => {
  const { source, target, snapshot } = await fixture();
  await symlink(resolve(source, "repository-runtime.js"), resolve(target, "repository-runtime.js"));
  expect(await inspectNodeRuntimeModule(target, snapshot)).toBe("conflict");
  await expect(materializeNodeRuntimeModule(target, snapshot)).rejects.toThrow();
  expect(await readFile(resolve(source, "repository-runtime.js"))).toEqual(
    snapshot.files.get("repository-runtime.js"),
  );
});

it("rejects empty, oversized and non-file source modules before reading their content", async () => {
  const { source } = await fixture();
  const path = resolve(source, "repository-runtime.js");
  await writeFile(path, "");
  await expect(readNodeRuntimeModule(source)).rejects.toThrow();
  await truncate(path, 64 * 1024 * 1024 + 1);
  await expect(readNodeRuntimeModule(source)).rejects.toThrow();
  await rm(path);
  await mkdir(path);
  await expect(readNodeRuntimeModule(source)).rejects.toThrow();
});
