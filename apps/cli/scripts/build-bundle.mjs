import { buildTerminalRuntime } from "./build-terminal-runtime.mjs";
import {
  buildRepositoryRuntime,
  repositoryRuntimeEntrypointPlugin,
  mergeRepositoryRuntimeMetadata,
} from "../../../scripts/distribution/lib/repository-runtime-bundle.mjs";
import { verifySchemaValidatorArtifact } from "../../../scripts/shared/schema-validator-artifact.mjs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

import { nodeSqliteBundlePlugin } from "../../../scripts/distribution/lib/node-sqlite-bundle.mjs";
import { normalizeGeneratedTextFile } from "../../../scripts/quality/lib/generated-text.mjs";

const cliRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(cliRoot, "../..");
const outputDirectory = resolve(cliRoot, "dist");

await verifySchemaValidatorArtifact(repositoryRoot);
await mkdir(outputDirectory, { recursive: true });

const terminal = await buildTerminalRuntime({ repositoryRoot, cliRoot, outputDirectory });
const runtimeDefines = { __LERVO_TERMINAL_RUNTIME_HASH__: JSON.stringify(terminal.contentHash) };

const runtime = await buildRepositoryRuntime(
  build,
  repositoryRoot,
  outputDirectory,
  true,
  normalizeGeneratedTextFile,
  runtimeDefines,
);

const result = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["apps/cli/src/bin.ts"],
  outfile: "apps/cli/dist/bin.js",
  bundle: true,
  define: runtimeDefines,
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

const nodeResult = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["apps/node-runtime/src/bin.ts"],
  define: runtimeDefines,
  outfile: "apps/cli/dist/node-runtime.js",
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

await Promise.all(
  ["bin.js", "node-runtime.js", "terminal-hook.js", "repository-runtime.js"].map((fileName) =>
    normalizeGeneratedTextFile(resolve(outputDirectory, fileName)),
  ),
);
await chmod(resolve(outputDirectory, "node-runtime.js"), 0o755);

await writeFile(
  resolve(outputDirectory, "bin.metafile.json"),
  `${JSON.stringify(mergeRepositoryRuntimeMetadata([result.metafile, nodeResult.metafile, terminal.metafile], runtime.metafile), null, 2)}\n`,
  "utf8",
);
