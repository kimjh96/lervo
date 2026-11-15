import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import ts from "typescript";

import { topLevelEffects } from "./source-module-effects.mjs";
import { createBarrelExportOrigins, relativeSourceFile } from "./test-barrel-export-origins.mjs";
import { sourceAliases } from "./test-source-aliases.mjs";

/**
 * Evaluation-order invariants of the `@lervo/*` source modules. The Vitest direct-import plugin
 * changes the order in which a test evaluates these modules and skips modules that nothing it
 * imports needs. Both are invisible while the modules form no value-import cycle and evaluate
 * nothing at top level that could act outside their own values (`source-module-effects.mjs`).
 * This check fails when either stops being true.
 *
 * A value import is an import or re-export declaration, except one marked `type` or one whose
 * named elements are all marked `type`. Dynamic imports evaluate later and are not edges.
 */
const reviewedSideEffects = new Map([
  [
    "packages/execution-reliability/src/effect-inventory.ts",
    // Asserts the module's own constants and changes no other module, so order is irrelevant.
    ["assertCompleteEffectInventory(foundationEffectInventory);"],
  ],
]);

/** Reviewed reasons why a repository function or class called at top level acts nowhere else. */
const digestOfArguments = "Returns a digest of its arguments.";
const literalBuilder = "Returns a new value built from its arguments and literals.";
const localStateFactory =
  "Returns closures over new local state; no I/O or shared state is touched until they are called.";
const reviewedCallees = new Map([
  ["apps/node-runtime/src/conversation-repository-work-completion.ts#sha256", digestOfArguments],
  [
    "packages/agent-organization/src/runtime-identity.ts#organizationIdentityHash",
    digestOfArguments,
  ],
  ["packages/execution-contract/src/turn-measurement.ts#digest", digestOfArguments],
  ["packages/execution-reliability/src/evidence-report.ts#digest", digestOfArguments],
  ["packages/live-trigger-contract/src/descriptor.ts#liveTriggerDescriptorHash", digestOfArguments],
  ["packages/repository-knowledge/src/integrity.ts#sha256", digestOfArguments],
  ["packages/search/src/integrity.ts#canonicalHash", digestOfArguments],
  ["packages/search/src/integrity.ts#contentId", digestOfArguments],
  [
    "packages/work-controller/src/operating-mandate-admission.ts#operatingContractHash",
    digestOfArguments,
  ],
  ["packages/repository-knowledge/src/integrity.ts#canonicalJson", literalBuilder],
  ["packages/execution-reliability/src/effect-inventory.ts#declareEffect", literalBuilder],
  ["packages/schemas/src/document-manifest.ts#ownershipCondition", literalBuilder],
  [
    "packages/repository-context/src/query-projector-contract.ts#productionSearchQueryProjectorIdentity",
    literalBuilder,
  ],
  ["packages/roles/src/profiles.ts#listBuiltInRoleDefinitions", literalBuilder],
  // It also validates the plan and throws on an invalid literal, like an assertion.
  ["packages/search/src/retrieval-plan-definition.ts#createSearchRetrievalPlan", literalBuilder],
  ["packages/project-storage/src/bootstrap.ts#createProjectStorageOpener", localStateFactory],
  ["packages/project-storage/src/storage-pool.ts#createProjectStoragePool", localStateFactory],
  [
    "packages/project/src/project-manifest-parser.ts#createProjectManifestParser",
    localStateFactory,
  ],
  [
    "packages/repository-context/src/context-quality-admission.ts#createQualityRecordingAdmission",
    localStateFactory,
  ],
  [
    "packages/repository-context/src/context-quality-commit.ts#createContextQualityCommitQueue",
    localStateFactory,
  ],
  [
    "packages/repository-context/src/context-quality-scope.ts#createQualityRecordingScopes",
    localStateFactory,
  ],
  [
    "packages/repository-context/src/context-preparation-host.ts#ContextPreparationHost",
    localStateFactory,
  ],
  [
    "packages/search/src/evaluation-engine-registry.ts#SearchEvaluationEngineRegistry",
    localStateFactory,
  ],
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

/**
 * Value-import specifiers and top-level side effects `{ line, text }` of one module.
 * `reviewedCallee` is passed to `topLevelEffects`.
 */
export function sourceModuleEvaluationFacts(path, content, { reviewedCallee } = {}) {
  const kind = /\.[cm]?js$/u.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const imports = source.statements
    .filter(evaluatesModule)
    .map((statement) => statement.moduleSpecifier.text);
  return { imports, sideEffects: topLevelEffects(source, { reviewedCallee }) };
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
  reviewedCallees: callees = reviewedCallees,
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
  const origins = createBarrelExportOrigins({ aliases });
  /** `<declaring module>#<export>` of a called import, or of a local function or class. */
  const calleeKey = (file, binding) => {
    if (binding.local) return `${repositoryPath(file)}#${binding.local}`;
    const target = aliases.get(binding.specifier) ?? relativeSourceFile(file, binding.specifier);
    if (target === null) return null;
    const origin = origins.resolve(target, binding.name);
    return `${repositoryPath(origin?.file ?? target)}#${origin?.name ?? binding.name}`;
  };
  const edges = new Map();
  const sideEffects = new Map();
  const consultedCallees = new Map();
  for (const file of modules) {
    const path = repositoryPath(file);
    const reviewedCallee = (binding) => {
      const key = calleeKey(file, binding);
      if (!consultedCallees.has(path)) consultedCallees.set(path, new Set());
      consultedCallees.get(path).add(key);
      return callees.has(key);
    };
    const facts = sourceModuleEvaluationFacts(path, readFileSync(file, "utf8"), {
      reviewedCallee,
    });
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
  const calledInReach = new Set(
    [...reached].flatMap((path) => [...(consultedCallees.get(path) ?? [])]),
  );
  for (const [key] of callees)
    if (!calledInReach.has(key)) issues.push(`${key}: reviewed callee is no longer called`);
  for (const cycle of valueImportCycles(reachedEdges))
    issues.push(`value-import cycle among ${cycle.join(", ")}`);
  const importCount = [...reachedEdges.values()].reduce((sum, targets) => sum + targets.length, 0);
  return { issues, moduleCount: reached.size, importCount };
}
