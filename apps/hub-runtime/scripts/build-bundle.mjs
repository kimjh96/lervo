import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

import { nodeSqliteBundlePlugin } from "../../../scripts/lib/node-sqlite-bundle.mjs";
import { normalizeGeneratedTextFile } from "../../../scripts/lib/generated-text.mjs";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(runtimeRoot, "../..");
const outputDirectory = resolve(runtimeRoot, "dist");

await mkdir(outputDirectory, { recursive: true });

const result = await build({
  absWorkingDir: repositoryRoot,
  entryPoints: ["apps/hub-runtime/src/bin.ts"],
  outfile: "apps/hub-runtime/dist/bin.js",
  bundle: true,
  banner: {
    js: 'import { createRequire as __lervoCreateRequire } from "node:module"; var require = __lervoCreateRequire(import.meta.url);',
  },
  format: "esm",
  legalComments: "none",
  logLevel: "silent",
  metafile: true,
  platform: "node",
  plugins: [nodeSqliteBundlePlugin],
  target: "node22.13",
});

await normalizeGeneratedTextFile(resolve(outputDirectory, "bin.js"));

await writeFile(
  resolve(outputDirectory, "bin.metafile.json"),
  `${JSON.stringify(result.metafile, null, 2)}\n`,
  "utf8",
);
