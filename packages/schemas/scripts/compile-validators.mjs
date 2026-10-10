import { Ajv2020, _ } from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { build, version as esbuildVersion } from "esbuild";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { schemaValidatorCompilerOptions } from "../../../scripts/shared/schema-validator-contract.mjs";
import { installPrimitiveEnumIndex } from "./primitive-enum-keyword.mjs";

/** Build-only compiler. No runtime validation imports or initializes Ajv. */
export async function compileSchemaValidators(packageRoot) {
  const base = {
    absWorkingDir: packageRoot,
    bundle: true,
    write: false,
    platform: "node",
    target: "node22.13",
    logLevel: "silent",
    legalComments: "none",
  };
  const catalogBuild = await build({
    ...base,
    format: "esm",
    stdin: {
      contents:
        'export {schemaCatalog,schemaReferences} from "./src/schema-catalog.ts";' +
        'export {formats} from "./src/validation-format.ts";',
      resolveDir: packageRoot,
      loader: "ts",
    },
  });
  const { schemaCatalog, schemaReferences, formats } = await import(
    `data:text/javascript;base64,${Buffer.from(catalogBuild.outputFiles[0].contents).toString("base64")}`
  );
  const ajv = new Ajv2020({
    ...schemaValidatorCompilerOptions,
    code: {
      ...schemaValidatorCompilerOptions.code,
      source: true,
      formats: _`require("lervo-schema-runtime").formats`,
    },
  });
  installPrimitiveEnumIndex(ajv);
  for (const [name, format] of Object.entries(formats)) ajv.addFormat(name, format);
  for (const schema of schemaReferences) ajv.addSchema(schema);
  const ids = {};
  for (const [name, schema] of Object.entries(schemaCatalog)) {
    ajv.compile(schema);
    const id = schema.$id ?? `urn:lervo:standalone:${name}`;
    if (!schema.$id) ajv.addSchema(schema, id);
    ids[name] = id;
  }
  const runtimeBuild = await build({
    ...base,
    stdin: {
      contents:
        'export {formats} from "./src/validation-format.ts";' +
        'export {enumContains} from "./src/validation-enum.ts";',
      resolveDir: packageRoot,
      loader: "ts",
    },
    format: "cjs",
  });
  const generated = standaloneCode(ajv, ids);
  const result = await build({
    ...base,
    format: "esm",
    minify: true,
    metafile: true,
    stdin: { contents: generated, sourcefile: "validators.cjs", resolveDir: packageRoot },
    plugins: [
      {
        name: "schema-validation-runtime",
        setup(context) {
          context.onResolve({ filter: /^lervo-schema-runtime$/ }, () => ({
            path: "runtime",
            namespace: "schema-validation-runtime",
          }));
          context.onLoad({ filter: /.*/, namespace: "schema-validation-runtime" }, () => ({
            contents: runtimeBuild.outputFiles[0].contents,
            loader: "js",
          }));
        },
      },
    ],
  });
  const require = createRequire(resolve(packageRoot, "package.json"));
  const dependencyRoots = [
    ...new Set(
      Object.keys(result.metafile.inputs).flatMap((path) => {
        const root = path
          .replaceAll("\\", "/")
          .match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
        return root ? [root] : [];
      }),
    ),
  ];
  const runtimeDependencies = (
    await Promise.all(
      dependencyRoots.map(async (path) => {
        const manifest = JSON.parse(
          await readFile(resolve(packageRoot, path, "package.json"), "utf8"),
        );
        return `${manifest.name}@${manifest.version}`;
      }),
    )
  ).sort();
  return {
    bytes: Buffer.from(result.outputFiles[0].contents),
    schemaCount: Object.keys(schemaCatalog).length,
    runtimeDependencies,
    toolchain: { ajv: require("ajv/package.json").version, esbuild: esbuildVersion },
  };
}
