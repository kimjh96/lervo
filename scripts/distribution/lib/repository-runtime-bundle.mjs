import {
  repositoryRuntimeValidationPlugin,
  buildRepositoryRuntimeValidators,
} from "./repository-runtime-validation.mjs";
import { writeRepositoryRuntimeInventory } from "./repository-runtime-inventory.mjs";
import { resolve } from "node:path";
import { nodeSqliteBundlePlugin } from "./node-sqlite-bundle.mjs";

/** One internal application module owns the CLI/Node implementation and admitted context ports. */
export async function buildRepositoryRuntime(
  build,
  repositoryRoot,
  outputDirectory,
  includeCli,
  normalizeGeneratedTextFile,
) {
  const exports = [
    'export { runNodeRuntimeEntry } from "../../apps/node-runtime/src/entry.ts";',
    'export { prepareRepositoryQualityContext, withRepositoryQualityObservation, verifyRepositoryContextOutcome, recordContextQualityVerification } from "@lervo/repository-context";',
    'export { canonicalHash } from "@lervo/search";',
    'export { openProjectStorage } from "@lervo/project-storage";',
    'export { inspectEventWriterCoordinate } from "@lervo/project";',
  ];
  if (includeCli) exports.push('export { runCli } from "./src/main.ts";');
  const fallback = await buildRepositoryRuntimeValidators(build, repositoryRoot, outputDirectory);
  const result = await build({
    absWorkingDir: repositoryRoot,
    stdin: {
      contents: exports.join("\n"),
      resolveDir: resolve(repositoryRoot, "apps/cli"),
      sourcefile: "repository-runtime-entry.mjs",
      loader: "js",
    },
    outfile: resolve(outputDirectory, "repository-runtime.js"),
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
    plugins: [repositoryRuntimeValidationPlugin(repositoryRoot), nodeSqliteBundlePlugin],
    target: "node22.13",
  });
  result.metafile = mergeRepositoryRuntimeMetadata([fallback.metafile], result.metafile);
  await writeRepositoryRuntimeInventory(
    repositoryRoot,
    outputDirectory,
    result.metafile,
    normalizeGeneratedTextFile,
  );
  return result;
}

/** Entrypoints retain process ownership; implementation imports resolve to the shipped module. */
export const repositoryRuntimeEntrypointPlugin = {
  name: "repository-runtime-entrypoint",
  setup(builder) {
    builder.onResolve({ filter: /^\.\/(main|entry)\.js$/ }, (args) => {
      const importer = args.importer.replaceAll("\\", "/");
      if (
        (args.path === "./main.js" && importer.endsWith("/apps/cli/src/bin.ts")) ||
        (args.path === "./entry.js" && importer.endsWith("/apps/node-runtime/src/bin.ts"))
      )
        return { path: "./repository-runtime.js", external: true };
    });
  },
};

export function mergeRepositoryRuntimeMetadata(entrypoints, runtime) {
  return {
    inputs: Object.assign({}, ...entrypoints.map((entry) => entry.inputs), runtime.inputs),
    outputs: Object.assign({}, ...entrypoints.map((entry) => entry.outputs), runtime.outputs),
  };
}
