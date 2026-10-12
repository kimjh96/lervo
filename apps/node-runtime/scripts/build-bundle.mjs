import {
  buildRepositoryRuntime,
  repositoryRuntimeEntrypointPlugin,
  mergeRepositoryRuntimeMetadata,
} from "../../../scripts/distribution/lib/repository-runtime-bundle.mjs";
import { copyNativeRuntimeArtifacts } from "../../../scripts/shared/native-runtime-artifact.mjs";
import { nativeCasSourceHash } from "../../../scripts/shared/native-cas-artifact.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";
import { verifySchemaValidatorArtifact } from "../../../scripts/shared/schema-validator-artifact.mjs";

import { nativeFileSyncSourceHash } from "../../../scripts/shared/native-file-sync-artifact.mjs";
import { nodeSqliteBundlePlugin } from "../../../scripts/distribution/lib/node-sqlite-bundle.mjs";
import { normalizeGeneratedTextFile } from "../../../scripts/quality/lib/generated-text.mjs";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(runtimeRoot, "../..");
const outputDirectory = resolve(runtimeRoot, "dist");

await verifySchemaValidatorArtifact(repositoryRoot);
await mkdir(outputDirectory, { recursive: true });

const runtime = await buildRepositoryRuntime(
  build,
  repositoryRoot,
  outputDirectory,
  false,
  normalizeGeneratedTextFile,
);
const result = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["apps/node-runtime/src/bin.ts"],
  outfile: "apps/node-runtime/dist/bin.js",
  bundle: true,
  banner: {
    js: 'import { createRequire as __lervoCreateRequire } from "node:module"; var require = __lervoCreateRequire(import.meta.url);',
  },
  external: ["@anthropic-ai/claude-agent-sdk"],
  format: "esm",
  legalComments: "none",
  logLevel: "silent",
  mainFields: ["module", "main"],
  metafile: true,
  platform: "node",
  plugins: [repositoryRuntimeEntrypointPlugin, nodeSqliteBundlePlugin],
  target: "node22.13",
});

await normalizeGeneratedTextFile(resolve(outputDirectory, "bin.js"));
await normalizeGeneratedTextFile(resolve(outputDirectory, "repository-runtime.js"));

await writeFile(
  resolve(outputDirectory, "bin.metafile.json"),
  `${JSON.stringify(mergeRepositoryRuntimeMetadata([result.metafile], runtime.metafile), null, 2)}\n`,
  "utf8",
);

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
