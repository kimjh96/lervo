export interface ArtifactEditableRange {
  startByte: number;
  endByte: number;
}
export interface ArtifactCorrectionEdit extends ArtifactEditableRange {
  replacement: string;
}

/** Ranges come from the effect owner. This function restricts a proposal; it grants no authority. */
export function applyArtifactCorrectionEdits(
  bytes: Uint8Array,
  ranges: ArtifactEditableRange[],
  edits: ArtifactCorrectionEdit[],
): Uint8Array {
  const validRange = (range: ArtifactEditableRange) =>
    Number.isSafeInteger(range.startByte) &&
    Number.isSafeInteger(range.endByte) &&
    range.startByte >= 0 &&
    range.endByte >= range.startByte &&
    range.endByte <= bytes.byteLength;
  if (
    bytes.byteLength > 1048576 ||
    !Array.isArray(ranges) ||
    !ranges.length ||
    ranges.length > 64 ||
    !ranges.every(validRange) ||
    !Array.isArray(edits) ||
    !edits.length ||
    edits.length > 64
  )
    throw new TypeError("Invalid correction ranges.");
  const ordered = edits.map((edit) => ({ ...edit })).sort((a, b) => a.startByte - b.startByte);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  decoder.decode(bytes);
  let cursor = 0;
  let previousStart = -1;
  let length = bytes.byteLength;
  const parts: Uint8Array[] = [];
  for (const edit of ordered) {
    if (
      !validRange(edit) ||
      edit.startByte < cursor ||
      edit.startByte === previousStart ||
      typeof edit.replacement !== "string" ||
      Buffer.byteLength(edit.replacement, "utf8") > 1048576 ||
      Buffer.from(edit.replacement, "utf8").toString("utf8") !== edit.replacement ||
      Object.keys(edit).some((key) => !["startByte", "endByte", "replacement"].includes(key)) ||
      !ranges.some((range) => edit.startByte >= range.startByte && edit.endByte <= range.endByte)
    )
      throw new TypeError("Correction exceeds its exact editable ranges.");
    // Decoding both boundaries rejects splitting a UTF-8 code point.
    decoder.decode(bytes.slice(0, edit.startByte));
    decoder.decode(bytes.slice(0, edit.endByte));
    const replacement = Buffer.from(edit.replacement, "utf8");
    length += replacement.byteLength - (edit.endByte - edit.startByte);
    if (length > 1048576) throw new TypeError("Correction exceeds the artifact bound.");
    parts.push(bytes.slice(cursor, edit.startByte), replacement);
    cursor = edit.endByte;
    previousStart = edit.startByte;
  }
  parts.push(bytes.slice(cursor));
  return Buffer.concat(parts);
}
