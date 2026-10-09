import type { RepositorySource, RepositorySourceUnit } from "./types.js";

export type ReadableSource = RepositorySource & { content: string; contentHash: string };
export type PackedSourceUnit = [
  id: string,
  version: string,
  hash: string,
  kind: RepositorySourceUnit["unitKind"],
  locator: string,
  startByte: number,
  endByte: number,
  startLine: number,
  endLine: number,
  title: string | null,
];

const kinds = new Set(["file", "markdown_section", "code_symbol", "config_key", "revision"]);

export function validPackedUnits(value: unknown): value is PackedSourceUnit[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item: unknown) => {
      if (!Array.isArray(item) || item.length !== 10) return false;
      const [id, version, hash, kind, locator, start, end, firstLine, lastLine, title] = item;
      return (
        typeof id === "string" &&
        /^unit_[a-f0-9]{24}$/u.test(id) &&
        typeof version === "string" &&
        /^uv_[a-f0-9]{24}$/u.test(version) &&
        typeof hash === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(hash) &&
        kinds.has(kind) &&
        typeof locator === "string" &&
        Number.isSafeInteger(start) &&
        start >= 0 &&
        Number.isSafeInteger(end) &&
        end >= start &&
        Number.isSafeInteger(firstLine) &&
        firstLine >= 1 &&
        Number.isSafeInteger(lastLine) &&
        lastLine >= firstLine &&
        (title === null || typeof title === "string")
      );
    })
  );
}

export function packSourceUnits(units: readonly RepositorySourceUnit[]): PackedSourceUnit[] {
  return units.map((unit) => [
    unit.unitId,
    unit.unitVersionId,
    unit.unitHash,
    unit.unitKind,
    unit.locator,
    unit.range.startByte,
    unit.range.endByte,
    unit.range.startLine,
    unit.range.endLine,
    unit.title ?? null,
  ]);
}

export function unpackSourceUnits(
  source: ReadableSource,
  units: PackedSourceUnit[],
): RepositorySourceUnit[] {
  return units.map(
    ([
      unitId,
      unitVersionId,
      unitHash,
      unitKind,
      locator,
      startByte,
      endByte,
      startLine,
      endLine,
      title,
    ]) => ({
      unitId,
      unitVersionId,
      sourceId: source.sourceId,
      sourceHash: source.contentHash,
      unitHash,
      unitKind,
      path: source.path,
      locator,
      range: { startByte, endByte, startLine, endLine },
      ...(title === null ? {} : { title }),
    }),
  );
}
