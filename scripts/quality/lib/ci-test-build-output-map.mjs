/**
 * Maps built outputs that tests read back to tracked sources (ADR-0565). Stage 1 records the
 * mapping as a note only; it does not yet decide reuse. A bundle maps to every input in its esbuild
 * metafile, generated schema validators to the sources their manifest hashed, a native addon to
 * the native artifact digest in the toolchain digest, and any other
 * `dist` file or directory to the source with the same stem when Git tracks one. Everything else
 * is unmapped.
 */
const buildOutput = /^(?:apps|packages)\/[^/]+\/dist(?:\/|$)/u;
const workspaceLink = /^(?:(?:apps|packages)\/[^/]+\/)?node_modules\/(@lervo\/[^/]+)\/(.*)$/u;
const sourceExtensions = [
  [/\.d\.ts\.map$/u, ".ts"],
  [/\.d\.ts$/u, ".ts"],
  [/\.js\.map$/u, ".ts"],
  [/\.js$/u, ".ts"],
  [/\.mjs$/u, ".mts"],
  [/\.cjs$/u, ".cts"],
];

const isCiTestBuildOutput = (path) => buildOutput.test(path);

/** Reads the outputs of a merged esbuild metafile as `{ output: { via, sources } }`. */
export function readBundleMetafile(metafile) {
  const generated = new Map();
  for (const [output, description] of Object.entries(metafile?.outputs ?? {})) {
    const sources = Object.keys(description?.inputs ?? {}).filter(
      (input) => !input.includes(":") && !input.startsWith("/"),
    );
    generated.set(output, { via: "bundle_metafile", sources: sources.sort() });
  }
  return generated;
}

/**
 * Reads the schema validator manifest, whose `inputs` are the exact sources its generator hashed,
 * as `{ output: { via, sources } }` for every file the generator writes into `directory`.
 */
export function readSchemaValidatorManifest(manifest, directory, outputs) {
  const sources = (manifest?.inputs ?? [])
    .map((input) => input?.[0])
    .filter((path) => typeof path === "string" && !path.startsWith("/"))
    .sort();
  return new Map(
    outputs.map((name) => [`${directory}/${name}`, { via: "schema_validator_manifest", sources }]),
  );
}

/**
 * Returns `{ mappings, unmapped }` for the given repository paths. A workspace link such as
 * `apps/cli/node_modules/@lervo/core/dist/index.js` resolves through the workspace directory first.
 */
export function mapCiTestBuildOutputs({
  paths,
  tracked,
  trackedDirectories,
  generated,
  workspaces,
}) {
  const mappings = new Map();
  const unmapped = new Set();
  const pending = [...paths];
  while (pending.length > 0) {
    const path = pending.pop();
    if (mappings.has(path) || unmapped.has(path)) continue;
    const link = workspaceLink.exec(path);
    if (link) {
      const directory = workspaces.get(link[1]);
      if (!directory) unmapped.add(path);
      else {
        const target = `${directory}/${link[2]}`;
        mappings.set(path, { via: "workspace_link", sources: [target] });
        if (!tracked.has(target)) pending.push(target);
      }
      continue;
    }
    if (!isCiTestBuildOutput(path)) continue;
    if (generated.has(path)) {
      const mapping = generated.get(path);
      mappings.set(path, mapping);
      pending.push(...mapping.sources.filter((source) => isCiTestBuildOutput(source)));
      continue;
    }
    if (/\/dist\/native(?:\/|$)/u.test(path)) {
      mappings.set(path, { via: "native_artifact", sources: [] });
      continue;
    }
    const stem = path.replace(/\/dist(?=\/|$)/u, "/src");
    const source = sourceExtensions
      .filter(([pattern]) => pattern.test(stem))
      .map(([pattern, extension]) => stem.replace(pattern, extension))
      .find((candidate) => tracked.has(candidate));
    if (source) mappings.set(path, { via: "source", sources: [source] });
    // A probed or listed output directory, such as `packages/core/dist`, follows its source tree.
    else if (trackedDirectories.has(stem)) mappings.set(path, { via: "source", sources: [stem] });
    else unmapped.add(path);
  }
  return { mappings, unmapped };
}
