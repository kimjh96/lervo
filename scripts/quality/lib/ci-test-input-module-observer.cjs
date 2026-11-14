"use strict";

const { types } = require("node:util");

/**
 * Observes the module loads that bypass the public filesystem API (ADR-0565): native addons
 * through `process.dlopen`, SQLite databases opened through a CommonJS `node:sqlite`, and ESM
 * graphs loaded by `require()`, whose members Node 22.13 reads internally.
 *
 * `node:sqlite` is patched only when CommonJS loads it. Loading it earlier would emit its
 * experimental warning in processes that never use it, and Node does not resynchronize the ESM
 * exports of scheme-only builtins, so an ESM import of it stays unobserved.
 */
function installModuleObserver({ Module, observe, legacyRequireEsm }) {
  const report = (event) => {
    try {
      observe(event);
    } catch {
      // Observation never changes the observed call.
    }
  };
  const dlopen = process.dlopen;
  process.dlopen = function (module, filename, ...rest) {
    report({ kind: "native", filename });
    return dlopen.call(this, module, filename, ...rest);
  };

  let sqlitePatched = false;
  const load = Module._load;
  Module._load = function (request, parent) {
    const result = load.apply(this, arguments);
    if (!sqlitePatched && request === "node:sqlite" && typeof result?.DatabaseSync === "function") {
      sqlitePatched = true;
      result.DatabaseSync = new Proxy(result.DatabaseSync, {
        construct(target, args, newTarget) {
          const database = Reflect.construct(target, args, newTarget);
          report({ kind: "sqlite", location: args[0] });
          return database;
        },
      });
    }
    if (legacyRequireEsm && types.isModuleNamespaceObject(result))
      report({ kind: "require_esm", request, parent: parent?.filename });
    return result;
  };
  return { sqlitePatched: () => sqlitePatched };
}

module.exports = { installModuleObserver };
