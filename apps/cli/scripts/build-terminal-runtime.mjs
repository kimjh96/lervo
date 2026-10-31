import { copyNativeRuntimeArtifacts } from "../../../scripts/shared/native-runtime-artifact.mjs";
import { nativeCasSourceHash } from "../../../scripts/shared/native-cas-artifact.mjs";
import { nativeFileSyncSourceHash } from "../../../scripts/shared/native-file-sync-artifact.mjs";
import {
  TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES,
  TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES,
} from "@lervo/repository-knowledge";
import { copyFile, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { build } from "esbuild";
import { nodeSqliteBundlePlugin } from "../../../scripts/distribution/lib/node-sqlite-bundle.mjs";
import { normalizeGeneratedTextFile } from "../../../scripts/quality/lib/generated-text.mjs";

/** Produces stable launcher bytes and a host bundle whose identity also binds native assets. */
export async function buildTerminalRuntime({ repositoryRoot, cliRoot, outputDirectory }) {
  await copyNativeRuntimeArtifacts(
    {
      syncDirectory: resolve(repositoryRoot, "packages/filesystem-durability/dist/native"),
      casDirectory: resolve(repositoryRoot, "packages/cas/dist/native"),
    },
    outputDirectory,
    {
      required: process.platform === "darwin",
      expectedSyncHash: await nativeFileSyncSourceHash(repositoryRoot),
      expectedCasHash: await nativeCasSourceHash(repositoryRoot),
    },
  );

  const nativeIdentity = createHash("sha256");
  for (const name of [
    "cas-io-darwin.node",
    "cas-io.json",
    "file-sync-darwin.node",
    "file-sync.json",
  ]) {
    const content = await readFile(resolve(outputDirectory, "native", name)).catch((error) => {
      if (error.code === "ENOENT" && process.platform !== "darwin") return Buffer.alloc(0);
      throw error;
    });
    nativeIdentity.update(name).update(content);
  }
  const nativeDigest = nativeIdentity.digest("hex");

  const hookResult = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["apps/cli/src/terminal-hook-bin.ts"],
    outfile: resolve(outputDirectory, "terminal-hook.js"),
    bundle: true,
    minify: true,
    banner: {
      js:
        `// Host native inventory: ${nativeDigest}\n` +
        'import { createRequire as __lervoCreateRequire } from "node:module"; var require = __lervoCreateRequire(import.meta.url);',
    },
    format: "esm",
    legalComments: "none",
    logLevel: "silent",
    mainFields: ["module", "main"],
    metafile: true,
    platform: "node",
    plugins: [nodeSqliteBundlePlugin],
    target: "node22.13",
  });

  await normalizeGeneratedTextFile(resolve(outputDirectory, "terminal-hook.js"));
  const runtimeHash = `sha256:${createHash("sha256")
    .update(await readFile(resolve(outputDirectory, "terminal-hook.js")))
    .digest("hex")}`;

  await copyFile(
    resolve(cliRoot, "src/terminal-hook-launcher.mjs"),
    resolve(outputDirectory, "terminal-hook-launcher.mjs"),
  );
  if (
    (await stat(resolve(outputDirectory, "terminal-hook-launcher.mjs"))).size >
    TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES
  )
    throw new Error("The terminal launcher exceeds 16 KiB.");
  const terminalHookBytes = (await stat(resolve(outputDirectory, "terminal-hook.js"))).size;
  if (terminalHookBytes > TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES)
    throw new Error(
      `dist/terminal-hook.js is ${terminalHookBytes} bytes, above the ${TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES}-byte terminal hook runtime budget.`,
    );

  return { contentHash: runtimeHash, metafile: hookResult.metafile };
}
