/** Byte-exact hunk location and application. Pure; no hunk ever touches bytes outside its range. */

export interface DocumentFreshnessByteRange {
  startByte: number;
  endByte: number;
}

export type DocumentFreshnessHunkLocation =
  | { status: "located"; ranges: DocumentFreshnessByteRange[] }
  | {
      status: "invalid";
      index: number;
      reason: "not_found" | "ambiguous" | "overlapping" | "empty";
    };

/**
 * Each proposed `before` text must occur exactly once in the source. Lervo, not the provider,
 * derives byte offsets, so a hallucinated offset can never select unrelated bytes.
 */
export function locateDocumentFreshnessHunks(
  source: Uint8Array,
  befores: readonly string[],
): DocumentFreshnessHunkLocation {
  const bytes = Buffer.from(source);
  const ranges: DocumentFreshnessByteRange[] = [];
  for (const [index, before] of befores.entries()) {
    const needle = Buffer.from(before, "utf8");
    if (needle.byteLength === 0) return { status: "invalid", index, reason: "empty" };
    const startByte = bytes.indexOf(needle);
    if (startByte < 0) return { status: "invalid", index, reason: "not_found" };
    if (bytes.indexOf(needle, startByte + 1) >= 0)
      return { status: "invalid", index, reason: "ambiguous" };
    ranges.push({ startByte, endByte: startByte + needle.byteLength });
  }
  const sorted = ranges
    .map((range, index) => ({ range, index }))
    .sort((left, right) => left.range.startByte - right.range.startByte);
  for (let position = 1; position < sorted.length; position += 1)
    if (sorted[position]!.range.startByte < sorted[position - 1]!.range.endByte)
      return { status: "invalid", index: sorted[position]!.index, reason: "overlapping" };
  return { status: "located", ranges };
}

/** Replaces each range with its replacement, from the end so earlier offsets stay valid. */
export function applyDocumentFreshnessHunks(
  source: Uint8Array,
  hunks: readonly { range: DocumentFreshnessByteRange; replacement: string }[],
): Uint8Array {
  let output = Buffer.from(source);
  for (const hunk of [...hunks].sort((left, right) => right.range.startByte - left.range.startByte))
    output = Buffer.concat([
      output.subarray(0, hunk.range.startByte),
      Buffer.from(hunk.replacement, "utf8"),
      output.subarray(hunk.range.endByte),
    ]);
  return new Uint8Array(output);
}

/**
 * Changed bytes: per hunk, the larger of the removed and inserted spans after their common prefix
 * and suffix, so a provider that quotes a whole line is measured by what it actually changes.
 */
export function documentFreshnessChangedBytes(
  source: Uint8Array,
  hunks: readonly { range: DocumentFreshnessByteRange; replacement: string }[],
): number {
  return hunks.reduce((total, hunk) => {
    const before = Buffer.from(source.subarray(hunk.range.startByte, hunk.range.endByte));
    const after = Buffer.from(hunk.replacement, "utf8");
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
      prefix += 1;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    )
      suffix += 1;
    return total + Math.max(before.length - prefix - suffix, after.length - prefix - suffix);
  }, 0);
}

/**
 * True when every byte outside the hunk ranges is identical in `output`, checked independently of
 * how the output was produced.
 */
export function documentFreshnessOutsideBytesUnchanged(
  source: Uint8Array,
  output: Uint8Array,
  hunks: readonly { range: DocumentFreshnessByteRange; replacement: string }[],
): boolean {
  const before = Buffer.from(source);
  const after = Buffer.from(output);
  let sourceOffset = 0;
  let outputOffset = 0;
  for (const hunk of [...hunks].sort(
    (left, right) => left.range.startByte - right.range.startByte,
  )) {
    const gap = hunk.range.startByte - sourceOffset;
    if (
      gap < 0 ||
      !before
        .subarray(sourceOffset, hunk.range.startByte)
        .equals(after.subarray(outputOffset, outputOffset + gap))
    )
      return false;
    outputOffset += gap + Buffer.byteLength(hunk.replacement, "utf8");
    sourceOffset = hunk.range.endByte;
  }
  return (
    before.byteLength - sourceOffset === after.byteLength - outputOffset &&
    before.subarray(sourceOffset).equals(after.subarray(outputOffset))
  );
}
