import {
  buildRepositoryRuntime,
  repositoryRuntimeEntrypointPlugin,
  mergeRepositoryRuntimeMetadata,
} from "../../../scripts/distribution/lib/repository-runtime-bundle.mjs";
import { copyNativeRuntimeArtifacts } from "../../../scripts/shared/native-runtime-artifact.mjs";
import { nativeCasSourceHash } from "../../../scripts/shared/native-cas-artifact.mjs";
import { nativeFileSyncSourceHash } from "../../../scripts/shared/native-file-sync-artifact.mjs";
import { verifySchemaValidatorArtifact } from "../../../scripts/shared/schema-validator-artifact.mjs";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES } from "@lervo/repository-knowledge";
import { build } from "esbuild";

import { nodeSqliteBundlePlugin } from "../../../scripts/distribution/lib/node-sqlite-bundle.mjs";
import { normalizeGeneratedTextFile } from "../../../scripts/quality/lib/generated-text.mjs";

const cliRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(cliRoot, "../..");
const outputDirectory = resolve(cliRoot, "dist");

await verifySchemaValidatorArtifact(repositoryRoot);
await mkdir(outputDirectory, { recursive: true });

const runtime = await buildRepositoryRuntime(
  build,
  repositoryRoot,
  outputDirectory,
  true,
  normalizeGeneratedTextFile,
);
const result = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["apps/cli/src/bin.ts"],
  outfile: "apps/cli/dist/bin.js",
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

const terminalHook = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["apps/cli/src/terminal-hook-bin.ts"],
  outfile: "apps/cli/dist/terminal-hook.js",
  bundle: true,
  minify: true,
  banner: {
    js: 'import { createRequire as __lervoCreateRequire } from "node:module"; var require = __lervoCreateRequire(import.meta.url);',
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

const residentSkillInputs = Object.values(terminalHook.metafile.outputs).flatMap((output) =>
  Object.entries(output.inputs)
    .filter(
      ([path, input]) =>
        input.bytesInOutput > 0 &&
        /repository-knowledge-runtime\/(?:src|dist)\/(?:terminal-installed-skills|terminal-skill-(?:stage|transcript(?:-adapters)?))\.[jt]s$/u.test(
          path,
        ),
    )
    .map(([path]) => path),
);
if (residentSkillInputs.length > 0)
  throw new Error(
    `Resident skill parsing entered the hook bundle: ${residentSkillInputs.join(", ")}`,
  );

const nodeResult = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["apps/node-runtime/src/bin.ts"],
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

// Repositories reject a generated hook runtime above this budget, which would block `lervo upgrade`.
const terminalHookBytes = (await stat(resolve(outputDirectory, "terminal-hook.js"))).size;
process.stdout.write(
  `Terminal hook runtime: ${terminalHookBytes} bytes (limit ${TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES}).\n`,
);
if (terminalHookBytes > TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES)
  throw new Error(
    `dist/terminal-hook.js is ${terminalHookBytes} bytes, above the ${TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES}-byte terminal hook runtime budget.`,
  );

await writeFile(
  resolve(outputDirectory, "bin.metafile.json"),
  `${JSON.stringify(mergeRepositoryRuntimeMetadata([result.metafile, nodeResult.metafile], runtime.metafile), null, 2)}\n`,
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
