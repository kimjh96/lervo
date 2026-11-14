"use strict";

const {
  isArray,
  isModuleNamespaceObject,
  processObject,
  values,
} = require("./ci-test-input-intrinsics.cjs");
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
  processObject.dlopen = observeCalls(processObject.dlopen, {
    before([, filename]) {
      const path = pathText(filename);
      if (path !== null) observe({ kind: "native", filename: path });
    },
  });
  return {
    /** Reports `require()`-loaded ESM graphs that this Node version read internally. */
    inspect() {
      if (!legacyRequireEsm) return;
      const cache = ownData(Module, "_cache");
      for (const module of cache === undefined ? [] : values(cache))
        if (isModuleNamespaceObject(ownData(module, "exports")))
          observe({ kind: "require_esm", filename: ownData(module, "id") });
    },
    sqliteLoaded() {
      const loaded = ownData(processObject, "moduleLoadList");
      return isArray(loaded) && loaded.includes("NativeModule sqlite");
    },
  };
}

module.exports = { installModuleObserver };
