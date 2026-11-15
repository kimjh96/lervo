import { enableCompileCache, flushCompileCache } from "node:module";

import { afterAll, inject } from "vitest";

// Vitest setup: every isolated test process compiles the same natively loaded modules, such as the
// generated schema validators and parser dependencies. Node's compile cache lets later processes
// reuse that work; V8 rejects an entry whose source or flags differ, so results cannot change.
const directory = inject("lervoCompileCacheDirectory");
if (typeof directory === "string") {
  enableCompileCache(directory);
  // The pool usually kills a worker instead of letting it exit, so Node would never write it.
  afterAll(() => flushCompileCache());
}
