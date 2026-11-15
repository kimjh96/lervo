import { dirname, relative, sep } from "node:path";

import { createBarrelExportOrigins } from "./test-barrel-export-origins.mjs";
import { scanTestModulePins } from "./test-module-pins.mjs";

// Repository export names are ASCII; any other name keeps its barrel import.
const identifierName = /^[A-Za-z_$][\w$]*$/u;

function importedName(specifier) {
  if (specifier.type === "ImportDefaultSpecifier") return "default";
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

function specifierFrom(importer, file) {
  const path = relative(dirname(importer), file).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

/**
 * The replacement for one `import { ... } from "@lervo/<package>"` declaration, or null. Each
 * resolved name is imported from its declaring module; unresolved names keep the barrel import.
 * The replacement `code` keeps the declaration's line count, so later source map lines stay exact.
 * `consulted` lists the modules whose exports decided the rewrite.
 */
export function directImportDeclaration({ code, declaration, importer, barrel, origins }) {
  const specifiers = declaration.specifiers;
  if (
    specifiers.length === 0 ||
    specifiers.some((entry) => entry.type === "ImportNamespaceSpecifier")
  )
    return null;
  const direct = new Map();
  const kept = [];
  const consulted = new Set();
  for (const specifier of specifiers) {
    const origin = origins.resolve(barrel, importedName(specifier));
    if (origin === null || !identifierName.test(origin.name)) {
      kept.push(specifier);
      continue;
    }
    for (const file of origin.consulted) consulted.add(file);
    const local = specifier.local.name;
    const bindings = direct.get(origin.file) ?? [];
    bindings.push(origin.name === local ? local : `${origin.name} as ${local}`);
    direct.set(origin.file, bindings);
  }
  if (direct.size === 0) return null;
  const statements = [...direct].map(
    ([file, bindings]) =>
      `import { ${bindings.join(", ")} } from ${JSON.stringify(specifierFrom(importer, file))};`,
  );
  if (kept.length > 0) {
    const defaults = kept.filter((entry) => entry.type === "ImportDefaultSpecifier");
    const named = kept.filter((entry) => entry.type === "ImportSpecifier");
    const clause = [
      ...defaults.map((entry) => entry.local.name),
      ...(named.length > 0
        ? [`{ ${named.map((entry) => code.slice(entry.start, entry.end)).join(", ")} }`]
        : []),
    ].join(", ");
    statements.push(`import ${clause} from ${JSON.stringify(declaration.source.value)};`);
  }
  const lines = code.slice(declaration.start, declaration.end).split("\n").length - 1;
  return { code: statements.join(" ") + "\n".repeat(lines), consulted: [...consulted].sort() };
}

/**
 * Vite plugin for the CI shard configuration only, because a single-file run would not earn back
 * its one-time pin scan (see docs/foundation/code-quality-and-commit-ci.md). Repository modules
 * import other packages through their `src/index.ts` barrels, so one named import evaluates the
 * whole package graph in every isolated test process. After TypeScript is stripped, this plugin
 * points each named import at the module that declares it. Bindings, module instances, and
 * product sources are unchanged; only modules that nothing imports are no longer evaluated.
 *
 * A rewritten module no longer loads the barrels it was resolved through, so test workers never
 * see them. `api.ciTestModuleInputs()` hands them to the ADR-0565 ledger reporter, which adds them
 * to the closure of every test file that loaded the module. They are not Vite watch files: Vite
 * resolves every watch file into the module graph on each transform, which measured slower than
 * the loading this plugin saves.
 */
export function directBarrelImports() {
  let rootPrefix;
  let aliases;
  let setupFiles;
  let initialize;
  let origins;
  let disabled = false;
  /** Absolute module id to the sorted absolute paths its rewrites consulted. */
  const moduleInputs = new Map();
  return {
    name: "lervo:direct-barrel-imports",
    enforce: "post",
    api: { ciTestModuleInputs: () => new Map(moduleInputs) },
    configResolved(config) {
      const root = config.root.split(sep).join("/");
      rootPrefix = `${root}/`;
      // The literal `resolve.alias` entries map each workspace package to its source entry.
      aliases = new Map(
        config.resolve.alias
          .filter((entry) => typeof entry.find === "string" && entry.find.startsWith("@lervo/"))
          .map((entry) => [entry.find, entry.replacement]),
      );
      initialize = (context) => {
        const disable = (reason) => {
          disabled = true;
          context.warn(`direct barrel imports disabled; ${reason}`);
        };
        // Setup files may mock modules from any path, so they must be known before scanning.
        if (setupFiles === undefined) return disable("Vitest setup files are unknown");
        const scan = scanTestModulePins({ repositoryRoot: config.root, aliases, setupFiles });
        if (scan.computedMocks.length > 0)
          disable(`computed mocks in ${scan.computedMocks.join(", ")}`);
        origins = createBarrelExportOrigins({ aliases, pinned: scan.pinned });
      };
    },
    /** Vitest reports each project's resolved setup and global setup files here. */
    configureVitest({ project }) {
      setupFiles = [
        ...(setupFiles ?? []),
        ...project.config.setupFiles,
        ...project.config.globalSetup,
      ];
    },
    transform(code, id) {
      moduleInputs.delete(id);
      if (rootPrefix === undefined || id.includes("?") || id.includes("/node_modules/"))
        return null;
      if (!id.startsWith(rootPrefix) || !code.includes('"@lervo/')) return null;
      if (origins === undefined && !disabled) initialize(this);
      if (disabled) return null;
      const edits = [];
      const consulted = new Set();
      for (const declaration of this.parse(code).body) {
        if (declaration.type !== "ImportDeclaration") continue;
        const barrel = aliases.get(declaration.source.value);
        if (barrel === undefined) continue;
        const replacement = directImportDeclaration({
          code,
          declaration,
          importer: id,
          barrel,
          origins,
        });
        if (replacement === null) continue;
        edits.push([declaration.start, declaration.end, replacement.code]);
        for (const file of replacement.consulted) consulted.add(file);
      }
      if (edits.length === 0) return null;
      moduleInputs.set(id, [...consulted].sort());
      let rewritten = code;
      for (const [start, end, replacement] of edits.reverse())
        rewritten = rewritten.slice(0, start) + replacement + rewritten.slice(end);
      // Every line keeps its number, so the source map chain before this plugin stays valid.
      return { code: rewritten, map: null };
    },
  };
}
