import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Vitest global setup: one V8 compile cache directory for the run, removed at teardown, so the
 * cache never outlives the run that wrote it. `test-compile-cache.mjs` binds workers to it.
 */
export default async function setup({ provide }) {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-test-compile-cache-"));
  provide("lervoCompileCacheDirectory", directory);
  return () => rm(directory, { recursive: true, force: true });
}
