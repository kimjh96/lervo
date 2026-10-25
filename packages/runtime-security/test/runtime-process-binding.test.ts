import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { nodeRuntimesDirectory } from "../src/managed-node-runtime-paths.js";
import { bindInstalledRuntimeProcess } from "../src/runtime-process-binding.js";

it("binds the physical runtime behind current until the process releases it", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-runtime-binding-")));
  try {
    const runtimes = nodeRuntimesDirectory(root, "linux");
    const directory = resolve(runtimes, "a".repeat(16));
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "node-runtime.js"), "export {};\n");
    await symlink("a".repeat(16), resolve(runtimes, "current"));
    const release = await bindInstalledRuntimeProcess(
      resolve(runtimes, "current/node-runtime.js"),
      {
        homeDirectory: root,
        platform: "linux",
        processIdentity: () => `proc_test_v1:sha256:${"a".repeat(64)}`,
      },
    );
    const path = resolve(directory, ".processes", `${process.pid}.json`);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      schemaVersion: 1,
      processId: process.pid,
      processIdentity: `proc_test_v1:sha256:${"a".repeat(64)}`,
      runtimeDirectory: "a".repeat(16),
    });
    await release();
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
