import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import ts from "typescript";

import { relativeSourceFile } from "./test-barrel-export-origins.mjs";

/**
 * Modules that tests use as whole module objects: Vitest mocks and actual imports, namespace
 * imports and `require` (whose members tests may spy on), and dynamic imports whose module object
 * the test keeps. Importers must keep reaching such a module itself, so the direct-import plugin
 * never passes through it. The scan reads each file's syntax tree, so strings and comments pin
 * nothing, and type positions such as `typeof import("x")` load nothing and pin nothing.
 *
 * Scanned files are every test path below `apps`, `packages`, and `scripts`, every file there that
 * imports `vitest` (no other file can call `vi.mock`, because Vitest globals are off), and every
 * configured setup and global setup file wherever it lives. A dynamic import with a computed
 * specifier names no fixed module and stays unpinned; the CI reference lists every form the
 * scan does not see.
 */
const mockCalls = new Set(["mock", "doMock", "unmock", "doUnmock", "importActual", "importMock"]);
const promiseMembers = new Set(["then", "catch", "finally"]);
const scannedRoots = ["apps", "packages", "scripts"];
const skippedDirectories = new Set(["node_modules", "dist", ".git", "coverage"]);
const sourceFile = /\.[cm]?[jt]sx?$/u;
const namespace = ts.SyntaxKind.NamespaceImport;

function isTestPath(path) {
  const segments = path.split("/");
  return (
    segments.includes("test") ||
    segments.includes("__tests__") ||
    /\.test\.[cm]?[jt]sx?$/u.test(path)
  );
}

function sourceFilesBelow(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !skippedDirectories.has(entry.name))
      sourceFilesBelow(resolve(directory, entry.name), files);
    else if (entry.isFile() && sourceFile.test(entry.name) && !entry.name.endsWith(".d.ts"))
      files.push(resolve(directory, entry.name));
  }
  return files;
}

const literalText = (node) =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
const isDynamicImport = (node) =>
  ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;

function isVitestMockCall(node) {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    (callee.expression.text === "vi" || callee.expression.text === "vitest") &&
    mockCalls.has(callee.name.text)
  );
}

/** A literal specifier, `import("literal")`, or null for a computed mock target. */
function mockSpecifier(argument) {
  if (argument !== undefined && isDynamicImport(argument))
    return literalText(argument.arguments[0]);
  return literalText(argument);
}

/**
 * True when a dynamic import's module object is used only to read members right away: a member
 * access other than a promise method, or object destructuring. Every other use keeps the object.
 */
function readsOnlyMembers(call) {
  let node = call;
  while (ts.isParenthesizedExpression(node.parent) || ts.isAwaitExpression(node.parent))
    node = node.parent;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node)
    return !promiseMembers.has(parent.name.text);
  if (ts.isElementAccessExpression(parent) && parent.expression === node) return true;
  return (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    ts.isObjectBindingPattern(parent.name)
  );
}

function scriptKind(file) {
  if (/\.tsx$/u.test(file)) return ts.ScriptKind.TSX;
  return /\.[cm]?ts$/u.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/**
 * Whole-module references in one file: the `pinned` module files, whether a mock names a
 * computed target, and whether the file imports `vitest`.
 */
export function moduleObjectReferencesIn(file, content, aliases) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind(file));
  const pinned = new Set();
  let computedMock = false;
  let importsVitest = false;
  const pin = (specifier) => {
    const target = aliases.get(specifier) ?? relativeSourceFile(file, specifier);
    if (target) pinned.add(target);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier === "vitest") importsVitest = true;
      // `import * as ns` and `import fallback, * as ns` both bind the namespace.
      const bindings = node.importClause?.namedBindings;
      if (specifier !== null && bindings?.kind === namespace && !node.importClause.isTypeOnly)
        pin(specifier);
    } else if (ts.isExportDeclaration(node)) {
      const specifier = literalText(node.moduleSpecifier);
      const clause = node.exportClause;
      if (specifier !== null && !node.isTypeOnly && clause && ts.isNamespaceExport(clause))
        pin(specifier);
    } else if (ts.isCallExpression(node)) {
      if (isVitestMockCall(node)) {
        const specifier = mockSpecifier(node.arguments[0]);
        if (specifier === null) computedMock = true;
        else pin(specifier);
      } else if (isDynamicImport(node)) {
        const specifier = literalText(node.arguments[0]);
        if (specifier === "vitest") importsVitest = true;
        if (specifier !== null && !readsOnlyMembers(node)) pin(specifier);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const specifier = literalText(node.arguments[0]);
        if (specifier === "vitest") importsVitest = true;
        if (specifier !== null) pin(specifier);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { pinned, computedMock, importsVitest };
}

const repositoryPath = (root, file) => relative(root, file).split(sep).join("/");

/**
 * Scans the test sources and every configured setup file. A computed mock target cannot be
 * resolved statically, so it is reported and the caller must not rewrite.
 */
export function scanTestModulePins({ repositoryRoot, aliases, setupFiles }) {
  const pinned = new Set();
  const computedMocks = [];
  const scan = (file, content, references = moduleObjectReferencesIn(file, content, aliases)) => {
    for (const target of references.pinned) pinned.add(target);
    if (references.computedMock) computedMocks.push(repositoryPath(repositoryRoot, file));
  };
  const setup = new Set(setupFiles.map((file) => resolve(repositoryRoot, file)));
  for (const file of setup) scan(file, readFileSync(file, "utf8"));
  for (const scanned of scannedRoots)
    for (const file of sourceFilesBelow(resolve(repositoryRoot, scanned))) {
      if (setup.has(file)) continue;
      const content = readFileSync(file, "utf8");
      if (isTestPath(repositoryPath(repositoryRoot, file))) scan(file, content);
      // Only a file that names `vitest` can import it; the syntax tree decides whether it does.
      else if (content.includes("vitest")) {
        const references = moduleObjectReferencesIn(file, content, aliases);
        if (references.importsVitest) scan(file, content, references);
      }
    }
  return { pinned, computedMocks: computedMocks.sort() };
}
