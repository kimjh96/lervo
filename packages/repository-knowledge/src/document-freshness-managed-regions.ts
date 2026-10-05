/**
 * Lervo-managed marker regions of any schema version, found line by line outside fenced code. The
 * ADR-0022 parser accepts only `schema=1`; generated blocks such as instruction routes use later
 * schemas and belong to their own generator, so freshness must recognize them without parsing them.
 */
export interface LervoManagedRegion {
  blockId: string;
  schema: number;
  fullRange: { start: number; end: number };
}

const beginPattern = /^<!-- lervo:begin block=([a-z][a-z0-9_-]*) schema=(\d+) -->\s*$/u;
const endPattern = /^<!-- lervo:end block=([a-z][a-z0-9_-]*) -->\s*$/u;
const fencePattern = /^\s{0,3}(`{3,}|~{3,})(.*)$/u;

export function lervoManagedRegions(bytes: Uint8Array): LervoManagedRegion[] {
  const text = Buffer.from(bytes).toString("utf8");
  const regions: LervoManagedRegion[] = [];
  let offset = 0;
  let fence: string | null = null;
  let open: { blockId: string; schema: number; start: number } | null = null;
  for (const line of text.split("\n")) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    const fenceMatch = fencePattern.exec(line);
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1]!.startsWith(fence) && fenceMatch[2]!.trim() === "")
        fence = null;
    } else if (fenceMatch !== null) fence = fenceMatch[1]!;
    else {
      const begin = beginPattern.exec(line);
      const end = endPattern.exec(line);
      if (begin !== null && open === null)
        open = { blockId: begin[1]!, schema: Number(begin[2]), start: offset };
      else if (end !== null && open !== null && end[1] === open.blockId) {
        regions.push({
          blockId: open.blockId,
          schema: open.schema,
          fullRange: { start: open.start, end: Math.min(offset + lineBytes, bytes.byteLength) },
        });
        open = null;
      }
    }
    offset += lineBytes;
  }
  return regions;
}

/** The ordered marker lines of every Lervo-managed region; an edit must leave them identical. */
export function lervoManagedMarkerLines(bytes: Uint8Array): string[] {
  const buffer = Buffer.from(bytes);
  return lervoManagedRegions(bytes).flatMap((region) => {
    const lines = buffer
      .subarray(region.fullRange.start, region.fullRange.end)
      .toString("utf8")
      .split("\n")
      .filter((line) => line !== "");
    return [lines[0]!, lines.at(-1)!];
  });
}
