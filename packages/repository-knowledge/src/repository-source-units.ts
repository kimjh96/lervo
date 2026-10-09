import { basename, extname } from "node:path";

import { sha256, stableId } from "./integrity.js";
import type { RepositorySource, RepositorySourceUnit } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import { GIT_REVISION_SOURCE_ADAPTER } from "./git-revision-source.js";
import {
  extractJavaScriptSymbolSpans,
  JAVASCRIPT_SOURCE_UNIT_ADAPTER,
} from "./javascript-source-units.js";
import { extractCssSymbolSpans, CSS_SOURCE_UNIT_ADAPTER } from "./css-source-units.js";
import { extractJsonKeySpans, JSON_SOURCE_UNIT_ADAPTER } from "./json-source-units.js";
import { extractYamlKeySpans, YAML_SOURCE_UNIT_ADAPTER } from "./yaml-source-units.js";

/** Bump materialization when unit identity, coordinates, headings, or failure semantics change. */
export const REPOSITORY_SOURCE_UNIT_BUILD = [
  "repository-source-materialization-v2",
  JAVASCRIPT_SOURCE_UNIT_ADAPTER,
  CSS_SOURCE_UNIT_ADAPTER,
  JSON_SOURCE_UNIT_ADAPTER,
  YAML_SOURCE_UNIT_ADAPTER,
  GIT_REVISION_SOURCE_ADAPTER,
].join("/");

function byteOffset(value: string, characterOffset: number): number {
  return Buffer.byteLength(value.slice(0, characterOffset));
}

export function unit(input: {
  projectId: string;
  source: RepositorySource & { content: string; contentHash: string };
  unitKind: RepositorySourceUnit["unitKind"];
  locator: string;
  startCharacter: number;
  endCharacter: number;
  startByte?: number;
  endByte?: number;
  startLine: number;
  endLine: number;
  title?: string;
  adapter?: string;
  versionBinding?: "source" | "unit";
}): RepositorySourceUnit {
  const bytes = input.source.content.slice(input.startCharacter, input.endCharacter);
  const unitHash = sha256(bytes);
  const unitId = stableId("unit", {
    projectId: input.projectId,
    sourceKind: input.source.kind,
    path: input.source.identityPath ?? input.source.path,
    unitKind: input.unitKind,
    locator: input.locator,
  });
  return {
    unitId,
    unitVersionId: stableId("uv", {
      unitId,
      ...(input.versionBinding === "unit" ? {} : { sourceHash: input.source.contentHash }),
      unitHash,
      adapter: input.adapter ?? "repository-source-unit-v1",
      ...(input.versionBinding === "unit" ? { versionBinding: "unit" } : {}),
    }),
    sourceId: input.source.sourceId,
    sourceHash: input.source.contentHash,
    unitHash,
    unitKind: input.unitKind,
    path: input.source.path,
    locator: input.locator,
    range: {
      startByte: input.startByte ?? byteOffset(input.source.content, input.startCharacter),
      endByte: input.endByte ?? byteOffset(input.source.content, input.endCharacter),
      startLine: input.startLine,
      endLine: input.endLine,
    },
    ...(input.title === undefined ? {} : { title: input.title }),
  };
}

function coordinateMap(
  value: string,
  offsets: number[],
): Map<number, { byte: number; line: number }> {
  const sorted = [...new Set(offsets)].sort((left, right) => left - right);
  const output = new Map<number, { byte: number; line: number }>();
  let previous = 0;
  let byte = 0;
  let line = 1;
  for (const offset of sorted) {
    if (!Number.isSafeInteger(offset) || offset < previous || offset > value.length) {
      throw new RepositoryKnowledgeError(
        "knowledge_unit_extraction_failed",
        "The source unit coordinates are invalid.",
      );
    }
    const segment = value.slice(previous, offset);
    byte += Buffer.byteLength(segment);
    line += segment.match(/\n/g)?.length ?? 0;
    output.set(offset, { byte, line });
    previous = offset;
  }
  return output;
}

function yamlKeyUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  const extension = extname(source.path).toLowerCase();
  if (extension !== ".yaml" && extension !== ".yml") return [];
  const spans = extractYamlKeySpans(source.content);
  const coordinates = coordinateMap(
    source.content,
    spans.flatMap((span) => [span.startCharacter, span.endCharacter]),
  );
  return spans.map((span) =>
    unit({
      projectId,
      source,
      unitKind: "config_key",
      locator: span.locator,
      startCharacter: span.startCharacter,
      endCharacter: span.endCharacter,
      startByte: coordinates.get(span.startCharacter)!.byte,
      endByte: coordinates.get(span.endCharacter)!.byte,
      startLine: coordinates.get(span.startCharacter)!.line,
      endLine: coordinates.get(span.endCharacter)!.line,
      title: span.pointer,
      adapter: YAML_SOURCE_UNIT_ADAPTER,
      versionBinding: "unit",
    }),
  );
}

function markdownUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  const headings = [...source.content.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)];
  const ranges = headings.map((match, index) => ({
    start: match.index,
    end: headings[index + 1]?.index ?? source.content.length,
  }));
  const coordinates = coordinateMap(
    source.content,
    ranges.flatMap(({ start, end }) => [start, end]),
  );
  return headings.map((match, index) => {
    const start = match.index;
    const end = ranges[index]?.end ?? source.content.length;
    const title = match[2]?.trim() ?? "untitled";
    const depth = match[1]?.length ?? 1;
    const parentTitles: string[] = [];
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = headings[cursor];
      if ((previous?.[1]?.length ?? 0) < depth) {
        parentTitles.unshift(previous?.[2]?.trim() ?? "untitled");
        if ((previous?.[1]?.length ?? 0) === 1) break;
      }
    }
    return unit({
      projectId,
      source,
      unitKind: "markdown_section",
      locator: `heading:${[...parentTitles, title].join(" > ")}`,
      startCharacter: start,
      endCharacter: end,
      startByte: coordinates.get(start)!.byte,
      endByte: coordinates.get(end)!.byte,
      startLine: coordinates.get(start)!.line,
      endLine: coordinates.get(end)!.line,
      title,
    });
  });
}

function codeSymbolUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  if (!/[.][cm]?[jt]sx?$/.test(source.path)) return [];
  const spans = extractJavaScriptSymbolSpans(source.content, source.path);
  const coordinates = coordinateMap(
    source.content,
    spans.flatMap((span) => [span.startCharacter, span.endCharacter]),
  );
  return spans.map((span) =>
    unit({
      projectId,
      source,
      unitKind: "code_symbol",
      locator: span.locator,
      startCharacter: span.startCharacter,
      endCharacter: span.endCharacter,
      startByte: coordinates.get(span.startCharacter)!.byte,
      endByte: coordinates.get(span.endCharacter)!.byte,
      startLine: coordinates.get(span.startCharacter)!.line,
      endLine: coordinates.get(span.endCharacter)!.line,
      title: span.qualifiedName,
      adapter: JAVASCRIPT_SOURCE_UNIT_ADAPTER,
      versionBinding: "unit",
    }),
  );
}

function jsonKeyUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  if (extname(source.path).toLowerCase() !== ".json") return [];
  const spans = extractJsonKeySpans(source.content);
  const coordinates = coordinateMap(
    source.content,
    spans.flatMap((span) => [span.startCharacter, span.endCharacter]),
  );
  return spans.map((span) =>
    unit({
      projectId,
      source,
      unitKind: "config_key",
      locator: span.locator,
      startCharacter: span.startCharacter,
      endCharacter: span.endCharacter,
      startByte: coordinates.get(span.startCharacter)!.byte,
      endByte: coordinates.get(span.endCharacter)!.byte,
      startLine: coordinates.get(span.startCharacter)!.line,
      endLine: coordinates.get(span.endCharacter)!.line,
      title: span.pointer,
      adapter: JSON_SOURCE_UNIT_ADAPTER,
      versionBinding: "unit",
    }),
  );
}

export function extractUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
  sourceUnitFailureMode: "fail" | "file_only" = "fail",
): RepositorySourceUnit[] {
  return extractUnitsWithOutcome(projectId, source, sourceUnitFailureMode).units;
}

export function extractUnitsWithOutcome(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
  sourceUnitFailureMode: "fail" | "file_only" = "fail",
): { units: RepositorySourceUnit[]; complete: boolean } {
  if (source.kind === "revision_metadata") {
    return {
      complete: true,
      units: [
        unit({
          projectId,
          source,
          unitKind: "revision",
          locator: "revision:HEAD",
          startCharacter: 0,
          endCharacter: source.content.length,
          startByte: 0,
          endByte: Buffer.byteLength(source.content),
          startLine: 1,
          endLine: 1,
          title: "Git HEAD commit",
          adapter: GIT_REVISION_SOURCE_ADAPTER,
          versionBinding: "unit",
        }),
      ],
    };
  }
  const fileUnit = unit({
    projectId,
    source,
    unitKind: "file",
    locator: "file:/",
    startCharacter: 0,
    endCharacter: source.content.length,
    startLine: 1,
    endLine: source.content.split("\n").length,
    title: basename(source.path),
  });
  let codeUnits: RepositorySourceUnit[];
  let jsonUnits: RepositorySourceUnit[];
  let yamlUnits: RepositorySourceUnit[];
  let cssSpans: ReturnType<typeof extractCssSymbolSpans>;
  try {
    codeUnits = codeSymbolUnits(projectId, source);
    jsonUnits = jsonKeyUnits(projectId, source);
    yamlUnits = yamlKeyUnits(projectId, source);
    cssSpans = source.path.toLocaleLowerCase().endsWith(".css")
      ? extractCssSymbolSpans(source.content)
      : [];
  } catch (error) {
    if (
      sourceUnitFailureMode !== "file_only" ||
      !(error instanceof RepositoryKnowledgeError) ||
      error.code !== "knowledge_unit_extraction_failed"
    ) {
      throw error;
    }
    return { units: [fileUnit], complete: false };
  }
  const cssCoordinates = coordinateMap(
    source.content,
    cssSpans.flatMap((span) => [span.startCharacter, span.endCharacter]),
  );
  return {
    complete: true,
    units: [
      fileUnit,
      ...(source.path.endsWith(".md") || source.path.endsWith(".mdx")
        ? markdownUnits(projectId, source)
        : []),
      ...codeUnits,
      ...jsonUnits,
      ...yamlUnits,
      ...cssSpans.map((span) =>
        unit({
          projectId,
          source,
          unitKind: "code_symbol",
          locator: span.locator,
          startCharacter: span.startCharacter,
          endCharacter: span.endCharacter,
          startByte: cssCoordinates.get(span.startCharacter)!.byte,
          endByte: cssCoordinates.get(span.endCharacter)!.byte,
          startLine: cssCoordinates.get(span.startCharacter)!.line,
          endLine: cssCoordinates.get(span.endCharacter)!.line,
          title: span.title,
          adapter: CSS_SOURCE_UNIT_ADAPTER,
          versionBinding: "unit",
        }),
      ),
    ],
  };
}
