import { ciTestPackageScopes } from "./ci-test-shadow-inputs.mjs";

/**
 * The input index of one CI run (ADR-0565, Stage 2): the digest of every input, copied tree and
 * resolution neighbourhood that its ledgers recorded, taken in the run's reconstructed tree before
 * tests could change it. Ledgers name inputs but hold no contents, so a later run compares its own
 * digests with this index. Inputs include each input's `package.json` scopes. The index holds
 * repository-relative paths and digests only, and anyone holding the run's ledgers, revision and
 * build artifact can rebuild it.
 */
export const CI_TEST_INPUT_INDEX_CONTRACT = "lervo-ci-test-input-index-v2";

const sortedEntries = (map) =>
  Object.fromEntries([...map].sort(([left], [right]) => (left < right ? -1 : 1)));

/** The input paths a closure depends on: the test file, its inputs and their package scopes. */
export function ciTestClosureInputs(record) {
  const paths = new Set([record.file, ...record.inputs]);
  for (const path of [...paths]) for (const scope of ciTestPackageScopes(path)) paths.add(scope);
  return [...paths];
}

/** `files`: resolved ledger files. `snapshot`: lookups of the run's reconstructed tree. */
export function createCiTestInputIndex({ run, files, snapshot }) {
  const inputs = new Map();
  const neighbours = new Map();
  const trees = new Map();
  for (const file of files) {
    for (const path of ciTestClosureInputs(file))
      if (!inputs.has(path)) inputs.set(path, snapshot.input(path));
    for (const path of [file.file, ...file.inputs])
      if (!neighbours.has(path)) neighbours.set(path, snapshot.neighbours(path));
    for (const path of file.trees) if (!trees.has(path)) trees.set(path, snapshot.tree(path));
  }
  return {
    schemaVersion: 2,
    contract: CI_TEST_INPUT_INDEX_CONTRACT,
    run: { id: run.id, revision: run.revision },
    inputs: sortedEntries(inputs),
    neighbours: sortedEntries(neighbours),
    trees: sortedEntries(trees),
  };
}

/** Validates a downloaded index as `{ run, inputs, neighbours, trees }` with `Map` lookups. */
export function readCiTestInputIndex(index) {
  const table = (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("ci_test_input_index_invalid");
    const entries = Object.entries(value);
    if (entries.some(([, digest]) => typeof digest !== "object" || digest === null))
      throw new Error("ci_test_input_index_invalid");
    return new Map(entries);
  };
  if (index?.contract !== CI_TEST_INPUT_INDEX_CONTRACT || !/^\d+$/u.test(index.run?.id ?? ""))
    throw new Error("ci_test_input_index_invalid");
  return {
    run: { id: index.run.id, revision: index.run.revision },
    inputs: table(index.inputs),
    neighbours: table(index.neighbours),
    trees: table(index.trees),
  };
}
