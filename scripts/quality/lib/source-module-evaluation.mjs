import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import ts from "typescript";

import { relativeSourceFile } from "./test-barrel-export-origins.mjs";
import { sourceAliases } from "./test-source-aliases.mjs";

/**
 * Evaluation-order invariants of the `@lervo/*` source modules. The Vitest direct-import plugin
 * changes the order in which a test evaluates these modules and skips modules that nothing it
 * imports needs. Both are invisible while the modules form no value-import cycle and evaluate
 * nothing at top level beyond declarations. This check fails when either stops being true.
 *
 * A value import is an import or re-export declaration, except one marked `type` or one whose
 * named elements are all marked `type`. Dynamic imports evaluate later and are not edges. A
 * top-level side effect is any top-level statement other than an import, export, function, class,
 * enum, interface, type alias, namespace, variable declaration, `export default`, or empty
 * statement. Expressions inside declarations, such as variable initializers, are not inspected.
 */
const reviewedSideEffects = new Map([
  [
    "packages/execution-reliability/src/effect-inventory.ts",
    // Asserts the module's own constants and changes no other module, so order is irrelevant.
    ["assertCompleteEffectInventory(foundationEffectInventory);"],
  ],
]);

const declarationKinds = new Set([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.EmptyStatement,
]);

function evaluatesModule(statement) {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    const bindings = clause.namedBindings;
    if (clause.name || !bindings || ts.isNamespaceImport(bindings)) return true;
    return bindings.elements.length === 0 || bindings.elements.some((entry) => !entry.isTypeOnly);
  }
  if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
    if (statement.isTypeOnly) return false;
    const clause = statement.exportClause;
    if (!clause || ts.isNamespaceExport(clause)) return true;
    return clause.elements.length === 0 || clause.elements.some((entry) => !entry.isTypeOnly);
  }
  return false;
}

/** Value-import specifiers and top-level side effects `{ line, text }` of one module. */
export function sourceModuleEvaluationFacts(path, content) {
  const kind = /\.[cm]?js$/u.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const imports = [];
  const sideEffects = [];
  for (const statement of source.statements) {
    if (evaluatesModule(statement)) imports.push(statement.moduleSpecifier.text);
    else if (!declarationKinds.has(statement.kind)) {
      const { line } = source.getLineAndCharacterOfPosition(statement.getStart(source));
      sideEffects.push({ line: line + 1, text: statement.getText(source) });
    }
  }
  return { imports, sideEffects };
}

/** Sorted members of every strongly connected component that forms a cycle (Tarjan). */
export function valueImportCycles(edges) {
  const order = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  let next = 0;
  const connect = (node) => {
    order.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of edges.get(node) ?? []) {
      if (!order.has(target)) {
        connect(target);
        low.set(node, Math.min(low.get(node), low.get(target)));
      } else if (onStack.has(target)) low.set(node, Math.min(low.get(node), order.get(target)));
    }
    if (low.get(node) !== order.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || (edges.get(node) ?? []).includes(node))
      cycles.push(component.sort());
  };
  for (const node of [...edges.keys()].sort()) if (!order.has(node)) connect(node);
  return cycles.sort((left, right) => (left[0] < right[0] ? -1 : 1));
}

const isTestPath = (path) => path.split("/").includes("test") || /\.test\.[cm]?[jt]s$/u.test(path);

function modulesBelow(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) modulesBelow(path, files);
    else if (entry.isFile() && /\.[cm]?[jt]s$/u.test(entry.name) && !entry.name.endsWith(".d.ts"))
      files.push(path);
  }
  return files;
}

/** Repository paths reachable from `entries` over `edges`. */
function reachableFrom(entries, edges) {
  const reached = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const path = queue.pop();
    if (reached.has(path) || !edges.has(path)) continue;
    reached.add(path);
    queue.push(...edges.get(path));
  }
  return reached;
}

/**
 * Checks the modules that the source entries aliased in `vitest.config.ts` reach through value
 * imports: only those can be reordered or skipped by a direct import. Entrypoints such as `bin.ts`
 * that no entry reaches are outside the claim. Returns the issues and the module and value-import
 * counts of the reached graph.
 */
export function inspectSourceModuleEvaluation({
  repositoryRoot,
  reviewedSideEffects: reviewed = reviewedSideEffects,
}) {
  const repositoryPath = (file) => relative(repositoryRoot, file).split(sep).join("/");
  const aliases = new Map(
    sourceAliases(readFileSync(resolve(repositoryRoot, "vitest.config.ts"), "utf8")).map(
      ([name, target]) => [name, resolve(repositoryRoot, target)],
    ),
  );
  const sourceDirectories = new Set(
    [...aliases.values()].map((target) =>
      target.slice(0, target.lastIndexOf(`${sep}src${sep}`) + 4),
    ),
  );
  const modules = [...sourceDirectories]
    .flatMap((directory) => modulesBelow(directory))
    .filter((file) => !isTestPath(repositoryPath(file)))
    .sort();
  const known = new Set(modules);
  const edges = new Map();
  const sideEffects = new Map();
  for (const file of modules) {
    const path = repositoryPath(file);
    const facts = sourceModuleEvaluationFacts(path, readFileSync(file, "utf8"));
    const targets = new Set();
    for (const specifier of facts.imports) {
      const target = aliases.get(specifier) ?? relativeSourceFile(file, specifier);
      if (target !== null && known.has(target)) targets.add(repositoryPath(target));
    }
    edges.set(path, [...targets].sort());
    sideEffects.set(path, facts.sideEffects);
  }
  const reached = reachableFrom([...aliases.values()].map(repositoryPath), edges);
  const reachedEdges = new Map([...edges].filter(([path]) => reached.has(path)));
  const issues = [];
  for (const path of [...reached].sort()) {
    const allowed = reviewed.get(path) ?? [];
    for (const { line, text } of sideEffects.get(path))
      if (!allowed.includes(text)) issues.push(`${path}:${line}: top-level side effect: ${text}`);
    for (const text of allowed)
      if (!sideEffects.get(path).some((effect) => effect.text === text))
        issues.push(`${path}: reviewed side effect no longer present: ${text}`);
  }
  for (const [path] of reviewed)
    if (!reached.has(path)) issues.push(`${path}: reviewed module is no longer reached`);
  for (const cycle of valueImportCycles(reachedEdges))
    issues.push(`value-import cycle among ${cycle.join(", ")}`);
  const importCount = [...reachedEdges.values()].reduce((sum, targets) => sum + targets.length, 0);
  return { issues, moduleCount: reached.size, importCount };
}
