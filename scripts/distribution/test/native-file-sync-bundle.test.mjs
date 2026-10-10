import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import {
  copyNativeFileSyncArtifact,
  nativeFileSyncSourceHash,
} from "../../shared/native-file-sync-artifact.mjs";

const run = promisify(execFile);
const { build } = createRequire(new URL("../../../apps/hub-runtime/package.json", import.meta.url))(
  "esbuild",
);
it.skipIf(process.platform !== "darwin")(
  "uses the adjacent native asset from a bundled CAS consumer",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-native-bundle-"));
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const output = resolve(root, "dist");
    await mkdir(output);
    try {
      await build({
        absWorkingDir: repositoryRoot,
        stdin: {
          resolveDir: repositoryRoot,
          contents: `
        import { FileSystemCas } from "./packages/cas/dist/index.js";
        import { open } from "node:fs/promises";
        import { join } from "node:path";
        const probe = await open(join(process.argv[2], "probe"), "w");
        const prototype = Object.getPrototypeOf(probe);
        await probe.close();
        prototype.sync = async () => { throw Error("ordinary_sync_called"); };
        const cas = await FileSystemCas.open(join(process.argv[2], "cas"));
        const results = await Promise.all(Array.from({ length: 4 }, (_, i) => cas.put("bundled " + i)));
        for (const [i, result] of results.entries())
          if (Buffer.from(await cas.get(result.uri)).toString() !== "bundled " + i) throw Error("content_changed");
        process.stdout.write("bundled_native_cas_passed\\n");
      `,
        },
        outfile: resolve(output, "consumer.mjs"),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22.13",
      });
      await copyNativeFileSyncArtifact(
        resolve(repositoryRoot, "packages/filesystem-durability/dist/native"),
        output,
        { required: true, expectedSourceHash: await nativeFileSyncSourceHash(repositoryRoot) },
      );
      const result = await run(process.execPath, [resolve(output, "consumer.mjs"), root]);
      expect(result.stdout).toBe("bundled_native_cas_passed\n");
      await rm(resolve(output, "native"), { recursive: true });
      await expect(
        run(process.execPath, [resolve(output, "consumer.mjs"), root]),
      ).rejects.toMatchObject({ stderr: expect.stringContaining("ordinary_sync_called") });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
