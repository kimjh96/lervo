import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { nodeSqliteBundlePlugin } from "../lib/node-sqlite-bundle.mjs";

describe("Node SQLite bundle compatibility", () => {
  it("replaces node:sqlite with a narrowly scoped compatibility module", () => {
    let resolveRegistration;
    let loadRegistration;
    nodeSqliteBundlePlugin.setup({
      onLoad(options, callback) {
        loadRegistration = { callback, options };
      },
      onResolve(options, callback) {
        resolveRegistration = { callback, options };
      },
    });

    assert.equal(resolveRegistration.options.filter.test("node:sqlite"), true);
    assert.equal(resolveRegistration.options.filter.test("node:path"), false);
    assert.deepEqual(resolveRegistration.callback({ namespace: "file" }), {
      namespace: "lervo-node-sqlite",
      path: "node:sqlite",
    });
    assert.deepEqual(resolveRegistration.callback({ namespace: "lervo-node-sqlite" }), {
      external: true,
      path: "node:sqlite",
    });
    assert.equal(loadRegistration.options.namespace, "lervo-node-sqlite");

    const loaded = loadRegistration.callback();
    assert.equal(loaded.loader, "js");
    assert.match(loaded.contents, /require\("node:sqlite"\)/u);
    assert.match(loaded.contents, /SQLite is an experimental feature/u);
    assert.match(loaded.contents, /finally \{/u);
    assert.match(loaded.contents, /process\.emitWarning = __lervoOriginalEmitWarning/u);
  });
});
