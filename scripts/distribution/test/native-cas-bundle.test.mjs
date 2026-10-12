import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { nativeCasSourceHash } from "../../shared/native-cas-artifact.mjs";
import { nativeFileSyncSourceHash } from "../../shared/native-file-sync-artifact.mjs";
import {
  copyNativeRuntimeArtifacts,
  readNativeRuntimeArtifact,
} from "../../shared/native-runtime-artifact.mjs";
import { smokeNativeCas } from "../../shared/native-cas-smoke.mjs";

const run = promisify(execFile);
const { build } = createRequire(new URL("../../../apps/hub-runtime/package.json", import.meta.url))(
  "esbuild",
);

it.skipIf(process.platform !== "darwin")(
  "executes native CAS in a four-file bundled consumer and preserves the ordinary fallback",
  async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-native-cas-bundle-"));
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
        import fs from "node:fs/promises";
        import { syncBuiltinESMExports } from "node:module";
        import { join, sep } from "node:path";
        const originalRead = fs.readFile;
        fs.link = async () => { throw Error("ordinary_cas_link"); };
        fs.readFile = async (path, ...args) => {
          if (String(path).includes(sep + "sha256" + sep)) throw Error("ordinary_cas_read");
          return originalRead(path, ...args);
        };
        syncBuiltinESMExports();
        const cas = await FileSystemCas.open(join(process.argv[2], "cas"));
        const results = await Promise.all(Array.from({ length: 4 }, (_, i) => cas.put("bundled " + i)));
        for (const [i, result] of results.entries())
          if (Buffer.from(await cas.get(result.uri)).toString() !== "bundled " + i) throw Error("content_changed");
        process.stdout.write("bundled_native_cas_namespace_passed\\n");
      `,
        },
        outfile: resolve(output, "consumer.mjs"),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22.13",
      });
      const identity = {
        required: true,
        expectedSyncHash: await nativeFileSyncSourceHash(repositoryRoot),
        expectedCasHash: await nativeCasSourceHash(repositoryRoot),
      };
      await copyNativeRuntimeArtifacts(
        {
          syncDirectory: resolve(repositoryRoot, "packages/filesystem-durability/dist/native"),
          casDirectory: resolve(repositoryRoot, "packages/cas/dist/native"),
        },
        output,
        identity,
      );
      await readNativeRuntimeArtifact(resolve(output, "native"), {
        ...identity,
        casRequired: true,
      });
      expect(await smokeNativeCas(resolve(output, "native"))).toBe("native");
      const result = await run(process.execPath, [resolve(output, "consumer.mjs"), root]);
      expect(result.stdout).toBe("bundled_native_cas_namespace_passed\n");
      for (const name of ["cas-io.json", "cas-io-darwin.node"])
        await rm(resolve(output, "native", name));
      await expect(
        run(process.execPath, [resolve(output, "consumer.mjs"), root]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("ordinary_cas_link"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
