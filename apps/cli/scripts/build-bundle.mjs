import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

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
  metafile: true,
  platform: "node",
  target: "node22.13",
});

await writeFile(
  resolve(outputDirectory, "bin.metafile.json"),
  `${JSON.stringify(result.metafile, null, 2)}\n`,
  "utf8",
);
