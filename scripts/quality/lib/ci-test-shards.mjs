/** Greedy duration balancing changes placement, never test selection or isolation. */
export function assignCiTestShards(files, durations, count) {
  if (!Number.isInteger(count) || count < 1 || count > 16 || files.length > 4096)
    throw new Error("ci_shard_coordinates_invalid");
  if (new Set(files.map((file) => file.id)).size !== files.length)
    throw new Error("ci_test_identity_duplicate");
  const groups = Array.from({ length: count }, () => ({ files: [], weight: 0 }));
  const measured = files
    .map((file) => {
      const duration = durations[file.path] ?? 0;
      if (!Number.isFinite(duration) || duration < 0 || duration > 600_000)
        throw new Error("ci_test_duration_invalid");
      return { ...file, weight: duration + 1500 };
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
