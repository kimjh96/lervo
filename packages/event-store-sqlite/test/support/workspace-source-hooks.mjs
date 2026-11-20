// Test-only module hooks: a plain Node child process loads workspace packages from source, the
// way the vitest aliases do, so a test can commit through a real store in another process.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../../..");
const aliases = new Map();
const config = readFileSync(resolvePath(root, "vitest.config.ts"), "utf8");
for (const match of config.matchAll(/"(@lervo\/[^"]+)":\s*fromRoot\(\s*"\.\/([^"]+)"/gu))
  aliases.set(match[1], resolvePath(root, match[2]));
aliases.set(
  "#coordinate-data-validation",
  resolvePath(root, "packages/schemas/src/coordinate-data-validation.ts"),
);

export async function resolve(specifier, context, next) {
  const alias = aliases.get(specifier);
  if (alias !== undefined) return { url: pathToFileURL(alias).href, shortCircuit: true };
  if (
    specifier.startsWith(".") &&
    specifier.endsWith(".js") &&
    context.parentURL?.endsWith(".ts")
  ) {
    const candidate = resolvePath(
      dirname(fileURLToPath(context.parentURL)),
      specifier.slice(0, -3) + ".ts",
    );
    if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }
  return next(specifier, context);
}

let typescript;
export async function load(url, context, next) {
  if (!url.startsWith("file:") || !url.endsWith(".ts")) return next(url, context);
  typescript ??= (await import("typescript")).default;
  const source = readFileSync(fileURLToPath(url), "utf8");
  const output = typescript.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  return { format: "module", source: output.outputText, shortCircuit: true };
}
