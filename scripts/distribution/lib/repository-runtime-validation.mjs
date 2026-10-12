import { resolve } from "node:path";

/** Only the shared application's validation import uses the finite eager selection. */
export function repositoryRuntimeValidationPlugin(repositoryRoot) {
  const validator = resolve(repositoryRoot, "packages/schemas/dist/validate.js");
  const coordinateParser = resolve(
    repositoryRoot,
    "packages/schemas/dist/parse-event-writer-coordinate.js",
  );
  return {
    name: "repository-runtime-validation-loading",
    setup(builder) {
      builder.onResolve({ filter: /^#coordinate-data-validation$/ }, (args) => {
        if (args.importer !== coordinateParser) return;
        return {
          path: resolve(
            repositoryRoot,
            "scripts/distribution/lib/repository-runtime-coordinate-data.mjs",
          ),
        };
      });
      builder.onResolve({ filter: /^#compiled-validators$/ }, (args) => {
        if (args.importer !== validator) return;
        return {
          path: resolve(
            repositoryRoot,
            "scripts/distribution/lib/repository-runtime-validator-map.mjs",
          ),
        };
      });
    },
  };
}

export async function buildRepositoryRuntimeValidators(build, repositoryRoot, outputDirectory) {
  return build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["packages/schemas/dist/generated/validators.js"],
    outfile: resolve(outputDirectory, "repository-runtime-validators.cjs"),
    bundle: true,
    platform: "node",
    target: "node22.13",
    format: "cjs",
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
  });
}
