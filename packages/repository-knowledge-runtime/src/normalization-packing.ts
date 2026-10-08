/** Oversized documents do not consume the capacity available to later eligible documents. */
export function packNormalizationDocuments(input: {
  paths: readonly string[];
  maximumDocuments: number;
  maximumBytes: number;
  size(path: string): number;
}): string[] {
  const selected: string[] = [];
  let bytes = 0;
  for (const path of input.paths) {
    if (selected.length >= input.maximumDocuments) break;
    const size = input.size(path);
    if (bytes + size > input.maximumBytes) continue;
    selected.push(path);
    bytes += size;
  }
  return selected;
}
