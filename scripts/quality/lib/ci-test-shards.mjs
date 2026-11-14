const maximumWeight = 900_000;

/**
 * Greedy weight balancing changes placement, never test selection or isolation. `profile` is
 * `readCiTestDurationProfile` output: per-path weights and the weight of every other file.
 */
export function assignCiTestShards(files, { weights, defaultWeight }, count) {
  if (!Number.isInteger(count) || count < 1 || count > 16 || files.length > 4096)
    throw new Error("ci_shard_coordinates_invalid");
  if (new Set(files.map((file) => file.id)).size !== files.length)
    throw new Error("ci_test_identity_duplicate");
  const groups = Array.from({ length: count }, () => ({ files: [], weight: 0 }));
  const measured = files
    .map((file) => {
      const weight = weights[file.path] ?? defaultWeight;
      if (!Number.isFinite(weight) || weight < 0 || weight > maximumWeight)
        throw new Error("ci_test_duration_invalid");
      return { ...file, weight };
    })
    .sort(
      (left, right) =>
        right.weight - left.weight || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  for (const file of measured) {
    const target = groups.reduce((best, candidate) =>
      candidate.weight < best.weight ? candidate : best,
    );
    target.files.push(file.id);
    target.weight += file.weight;
  }
  return groups.map(({ files: selected }) => selected);
}
