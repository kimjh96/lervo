import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

import { nodeSqliteBundlePlugin } from "../../../scripts/lib/node-sqlite-bundle.mjs";
import { normalizeGeneratedTextFile } from "../../../scripts/lib/generated-text.mjs";

const cliRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(cliRoot, "../..");
const outputDirectory = resolve(cliRoot, "dist");

await mkdir(outputDirectory, { recursive: true });

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
  plugins: [nodeSqliteBundlePlugin],
  target: "node22.13",
});

await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["apps/cli/src/terminal-hook-bin.ts"],
  outfile: "apps/cli/dist/terminal-hook.js",
  bundle: true,
  banner: {
    js: 'import { createRequire as __lervoCreateRequire } from "node:module"; var require = __lervoCreateRequire(import.meta.url);',
  },
  format: "esm",
  legalComments: "none",
  logLevel: "silent",
  mainFields: ["module", "main"],
  platform: "node",
  plugins: [nodeSqliteBundlePlugin],
  target: "node22.13",
});

await build({
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
  platform: "node",
  plugins: [nodeSqliteBundlePlugin],
  target: "node22.13",
});

await Promise.all(
  ["bin.js", "node-runtime.js", "terminal-hook.js"].map((fileName) =>
    normalizeGeneratedTextFile(resolve(outputDirectory, fileName)),
  ),
);
await chmod(resolve(outputDirectory, "node-runtime.js"), 0o755);

await writeFile(
  resolve(outputDirectory, "bin.metafile.json"),
  `${JSON.stringify(result.metafile, null, 2)}\n`,
  "utf8",
);
