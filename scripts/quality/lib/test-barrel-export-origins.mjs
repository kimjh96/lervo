import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import ts from "typescript";

/**
 * Static origins of the value exports of source barrels, for the Vitest direct-import plugin. A
 * name resolves through relative re-exports, and re-exports of other aliased source packages, to
 * the module that declares it. Anything this cannot prove, such as an ambiguous `export *`, a
 * namespace re-export, an unaliased package, or a pinned pass-through module, stays unresolved and
 * keeps its barrel import.
 */
const found = (file, name) => ({ state: "found", file, name });
const absent = { state: "absent" };
const unknown = { state: "unknown" };
const sourceExtensions = [".ts", ".mts", ".tsx", ".js", ".mjs"];

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The file a relative specifier names, as Vite resolves the repository's `.js` source imports. */
export function relativeSourceFile(importer, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const base = resolve(dirname(importer), specifier);
  const stem = base.replace(/\.[cm]?js$/u, "");
  const candidates = [
    base,
    ...sourceExtensions.map((extension) => `${stem}${extension}`),
    ...sourceExtensions.map((extension) => resolve(base, `index${extension}`)),
  ];
  return (
    candidates.find((candidate) => /\.[cm]?[jt]sx?$/u.test(candidate) && isFile(candidate)) ?? null
  );
}

const hasModifier = (node, kind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((entry) => entry.kind === kind);

function bindingNames(name, names = []) {
  if (ts.isIdentifier(name)) names.push(name.text);
  else
    for (const element of name.elements)
      if (!ts.isOmittedExpression(element)) bindingNames(element.name, names);
  return names;
}

// Identifiers and string literal module export names both carry `text`.
const moduleName = (name) => name.text;

/** Value exports of one module: local declarations, named and star re-exports, namespaces. */
export function parseModuleExports(file, content) {
  const kind = /\.[cm]?js$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false, kind);
  const local = new Set();
  const named = new Map();
  const stars = [];
  const namespaces = new Set();
  const imported = new Map();
  const pending = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (clause.name) imported.set(clause.name.text, { specifier, name: "default" });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        imported.set(bindings.name.text, { specifier, name: "*" });
      else if (bindings)
        for (const element of bindings.elements)
          if (!element.isTypeOnly)
            imported.set(element.name.text, {
              specifier,
              name: moduleName(element.propertyName ?? element.name),
            });
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier?.text;
      const clause = statement.exportClause;
      if (specifier !== undefined && !clause) stars.push(specifier);
      else if (clause && ts.isNamespaceExport(clause)) namespaces.add(moduleName(clause.name));
      else if (clause)
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          const exported = moduleName(element.name);
          const original = moduleName(element.propertyName ?? element.name);
          if (specifier !== undefined) named.set(exported, { specifier, name: original });
          else pending.push([exported, original]);
        }
    } else if (ts.isExportAssignment(statement)) {
      local.add("default");
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) local.add("default");
      else if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          for (const name of bindingNames(declaration.name)) local.add(name);
      else if (statement.name && ts.isIdentifier(statement.name)) local.add(statement.name.text);
    }
  }
  // `import { a } from "./a.js"; export { a };` re-exports the imported binding.
  for (const [exported, original] of pending) {
    const binding = imported.get(original);
    if (binding?.name === "*") namespaces.add(exported);
    else if (binding) named.set(exported, binding);
    else local.add(exported);
  }
  return { local, named, stars, namespaces };
}

/**
 * Resolves exported names to their declaring modules. `pinned` lists modules that must not be
 * passed through, because a test mocks, spies on, or dynamically imports them as a whole. Each
 * resolution also lists the modules whose exports decided it: a rewritten importer depends on
 * them although it no longer loads them.
 */
export function createBarrelExportOrigins({
  aliases = new Map(),
  pinned = new Set(),
  read = (file) => readFileSync(file, "utf8"),
} = {}) {
  const exportsByFile = new Map();
  const exportsOf = (file) => {
    if (!exportsByFile.has(file)) exportsByFile.set(file, parseModuleExports(file, read(file)));
    return exportsByFile.get(file);
  };

  /** Memoized `{ result, consulted }` steps, keyed by module and exported name. */
  const steps = new Map();
  function origin(file, name, visiting) {
    const key = `${file}\0${name}`;
    if (steps.has(key)) return steps.get(key);
    if (visiting.has(key)) return { result: unknown, consulted: new Set([file]) };
    visiting.add(key);
    const step = declaredOrigin(file, name, visiting);
    visiting.delete(key);
    steps.set(key, step);
    return step;
  }

  function declaredOrigin(file, name, visiting) {
    const consulted = new Set([file]);
    const settle = (result) => ({ result, consulted });
    const follow = (specifier, exported) => {
      const step = through(file, specifier, exported, visiting);
      for (const path of step.consulted) consulted.add(path);
      return step.result;
    };
    const exports = exportsOf(file);
    if (exports.local.has(name)) return settle(found(file, name));
    if (exports.namespaces.has(name)) return settle(unknown);
    const reexport = exports.named.get(name);
    if (reexport) return settle(follow(reexport.specifier, reexport.name));
    if (name === "default") return settle(absent);
    let result = absent;
    for (const specifier of exports.stars) {
      const candidate = follow(specifier, name);
      if (candidate.state === "unknown") return settle(unknown);
      if (candidate.state !== "found") continue;
      if (
        result.state === "found" &&
        (result.file !== candidate.file || result.name !== candidate.name)
      )
        return settle(unknown);
      result = candidate;
    }
    return settle(result);
  }

  function through(file, specifier, name, visiting) {
    const target = aliases.get(specifier) ?? relativeSourceFile(file, specifier);
    if (target === null) return { result: unknown, consulted: new Set() };
    const step = origin(target, name, visiting);
    // A pinned module may still declare the name; it is only never skipped over.
    if (step.result.state === "found" && step.result.file !== target && pinned.has(target))
      return { result: unknown, consulted: step.consulted };
    return step;
  }

  return {
    /**
     * `{ file, name, consulted }` of the declaring module, with the sorted modules whose exports
     * decided it, or null when the barrel import must remain.
     */
    resolve(barrel, name) {
      if (pinned.has(barrel)) return null;
      const { result, consulted } = origin(barrel, name, new Set());
      return result.state === "found" && result.file !== barrel
        ? { file: result.file, name: result.name, consulted: [...consulted].sort() }
        : null;
    },
  };
}
