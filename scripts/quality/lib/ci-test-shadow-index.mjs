/**
 * The input index of one CI run (ADR-0565, Stage 2): the digest of every file and copied tree its
 * ledgers recorded, taken in the run's reconstructed tree before tests could change it. Ledgers
 * name inputs but hold no contents, so a later run compares its own digests with this index. The
 * index holds repository-relative paths and digests only, and anyone holding the run's ledgers,
 * revision and build artifact can rebuild it.
 */
export const CI_TEST_INPUT_INDEX_CONTRACT = "lervo-ci-test-input-index-v1";

const sortedEntries = (map) =>
  Object.fromEntries([...map].sort(([left], [right]) => (left < right ? -1 : 1)));

/** `files`: resolved ledger files. `snapshot`: lookups of the run's reconstructed tree. */
export function createCiTestInputIndex({ run, files, snapshot }) {
  const inputs = new Map();
  const trees = new Map();
  for (const file of files) {
    for (const path of [file.file, ...file.inputs])
      if (!inputs.has(path)) inputs.set(path, snapshot.input(path));
    for (const path of file.trees) if (!trees.has(path)) trees.set(path, snapshot.tree(path));
  }
  return {
    schemaVersion: 1,
    contract: CI_TEST_INPUT_INDEX_CONTRACT,
    run: { id: run.id, revision: run.revision },
    inputs: sortedEntries(inputs),
    trees: sortedEntries(trees),
  };
}

/** Validates a downloaded index as `{ run, inputs, trees }` with `Map` lookups. */
export function readCiTestInputIndex(index) {
  const table = (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("ci_test_input_index_invalid");
    const entries = Object.entries(value);
    if (entries.some(([, digest]) => typeof digest !== "string"))
      throw new Error("ci_test_input_index_invalid");
    return new Map(entries);
  };
  if (index?.contract !== CI_TEST_INPUT_INDEX_CONTRACT || !/^\d+$/u.test(index.run?.id ?? ""))
    throw new Error("ci_test_input_index_invalid");
  return {
    run: { id: index.run.id, revision: index.run.revision },
    inputs: table(index.inputs),
    trees: table(index.trees),
  };
}
