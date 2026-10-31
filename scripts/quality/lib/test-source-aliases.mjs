import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

// These packages have no importable source entrypoint. Exact names only; subpaths need review.
export const builtArtifactExceptions = new Map([
  ["@lervo/cli", "Executable distribution; tests invoke the built CLI or inspect packed files."],
  [
    "@lervo/node-runtime-dependencies",
    "Dependency-only manifest for standalone Node distributions; no source or runtime export.",
  ],
]);

function parse(path, content) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length > 0) throw new Error(`Cannot parse ${path}.`);
  return source;
}

function property(object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  return object.properties.find(
    (entry) => ts.isPropertyAssignment(entry) && entry.name.getText().replaceAll('"', "") === name,
  )?.initializer;
}

export function sourceAliases(content) {
  const source = parse("vitest.config.ts", content);
  const assignment = source.statements.find(ts.isExportAssignment);
  const config = assignment?.expression;
  const object = config && ts.isCallExpression(config) ? config.arguments[0] : undefined;
  const aliases = property(property(object, "resolve"), "alias");
  if (!aliases || !ts.isObjectLiteralExpression(aliases)) {
    throw new Error("Expected a literal resolve.alias object in vitest.config.ts.");
  }
  return aliases.properties.map((entry) => {
    if (
      !ts.isPropertyAssignment(entry) ||
      !ts.isStringLiteral(entry.name) ||
      !ts.isCallExpression(entry.initializer) ||
      entry.initializer.expression.getText(source) !== "fromRoot" ||
      entry.initializer.arguments.length !== 1 ||
      !ts.isStringLiteral(entry.initializer.arguments[0])
    ) {
      throw new Error("Source aliases must use literal names and fromRoot paths.");
    }
    return [entry.name.text, entry.initializer.arguments[0].text];
  });
}

export function testImports(path, content) {
  const source = parse(path, content);
  const imports = new Set();
  function add(node) {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      imports.add(node.text);
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal);
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (
        expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(expression) && expression.text === "require") ||
        (ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          ["vi", "vitest"].includes(expression.expression.text) &&
          ["mock", "doMock", "unmock", "doUnmock", "importActual", "importMock"].includes(
            expression.name.text,
          ))
      ) {
        add(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...imports].toSorted();
}

export function checkTestSourceAliases({
  packages,
  aliases,
  imports,
  exceptions = builtArtifactExceptions,
}) {
  const issues = [];
  const names = new Set(packages.map((entry) => entry.name));
  for (const { path, specifiers } of imports) {
    for (const specifier of specifiers) {
      const name = specifier.split("/").slice(0, 2).join("/");
      if (!names.has(name)) continue;
      // Vite uses the first matching alias, including root-prefix matches.
      const match = aliases.find(([key]) => specifier === key || specifier.startsWith(`${key}/`));
      if (!match) {
        if (!exceptions.get(specifier)?.trim())
          issues.push(`${path}: missing source alias for ${specifier}.`);
        continue;
      }
      const owner = packages.find((entry) => entry.name === name);
      if (match[0] !== specifier || !match[1].startsWith(`./${owner.directory}/src/`)) {
        issues.push(`${path}: ${specifier} needs an exact alias into ${owner.directory}/src/.`);
      }
    }
  }
  return [...new Set(issues)].toSorted();
}

export function inspectTestSourceAliases(repositoryRoot) {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split("\0")
    .filter((path) => path && existsSync(resolve(repositoryRoot, path)));
  const packages = paths
    .filter((path) => /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(path))
    .map((path) => ({
      name: JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")).name,
      directory: path.slice(0, -"/package.json".length),
    }));
  const aliases = sourceAliases(readFileSync(resolve(repositoryRoot, "vitest.config.ts"), "utf8"));
  const tests = paths.filter(
    (path) =>
      /^(?:apps|packages|scripts)\//u.test(path) &&
      /\.[cm]?[jt]sx?$/u.test(path) &&
      (/\.test\.[cm]?[jt]sx?$/u.test(path) || /\/(?:test|__tests__)\//u.test(path)),
  );
  const imports = tests.map((path) => ({
    path,
    specifiers: testImports(path, readFileSync(resolve(repositoryRoot, path), "utf8")),
  }));
  const issues = checkTestSourceAliases({ packages, aliases, imports });
  for (const [name, target] of aliases) {
    if (!existsSync(resolve(repositoryRoot, target)))
      issues.push(`${name}: alias target is missing: ${target}.`);
  }
  return { issues, packageCount: packages.length, testFileCount: tests.length, imports };
}
