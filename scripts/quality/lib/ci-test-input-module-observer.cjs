"use strict";

const { types } = require("node:util");

const { observeCalls, ownData, pathText } = require("./ci-test-input-transparent-call.cjs");

/**
 * Observes the module loads that bypass the public filesystem API (ADR-0565): native addons
 * through `process.dlopen`, and ESM graphs that `require()` loads on Node 22.13, whose members
 * Node reads internally. The latter are found in the CommonJS cache when the record is spooled,
 * so `Module._load` stays unwrapped and module errors keep their stacks.
 *
 * `node:sqlite` is not wrapped: replacing `DatabaseSync` changes its identity for code that
 * compares constructors or loaded the module through ESM first. The recorder only notes that it
 * was loaded.
 */
function installModuleObserver({ Module, observe, legacyRequireEsm }) {
  process.dlopen = observeCalls(process.dlopen, {
    before([, filename]) {
      const path = pathText(filename);
      if (path !== null) observe({ kind: "native", filename: path });
    },
  });
  return {
    /** Reports `require()`-loaded ESM graphs that this Node version read internally. */
    inspect() {
      if (!legacyRequireEsm) return;
      for (const module of Object.values(Module._cache))
        if (types.isModuleNamespaceObject(ownData(module, "exports")))
          observe({ kind: "require_esm", filename: ownData(module, "id") });
    },
    sqliteLoaded: () => process.moduleLoadList?.includes("NativeModule sqlite") === true,
  };
}

module.exports = { installModuleObserver };
