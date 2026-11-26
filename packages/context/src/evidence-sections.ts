import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import { ContextQualityError } from "./quality-request.js";
import { MAX_CONTEXT_SOURCE_BYTES } from "./source-limits.js";

export interface ExactEvidenceSection {
  byteStart: number;
  byteEnd: number;
  sectionHash: string;
  locator: string;
}
const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const terms = (text: string) =>
  new Set(text.toLocaleLowerCase("en").match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);

/** Complete Markdown sections, preserving source byte ranges. Never slice through a clause. */
export function selectEvidenceSections(input: {
  bytes: Uint8Array;
  expectedHash: string;
  query: string;
  maximumBytes: number;
}): { content: string; sections: ExactEvidenceSection[]; sourceHash: string } | null {
  if (
    input.bytes.byteLength > MAX_CONTEXT_SOURCE_BYTES ||
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes < 0
  )
    throw new ContextQualityError("context_contract_invalid");
  const sourceHash = hash(input.bytes);
  if (sourceHash !== input.expectedHash) throw new ContextQualityError("context_binding_stale");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes);
  const section = (start: number, end: number, locator: string): ExactEvidenceSection => {
    const byteStart = Buffer.byteLength(text.slice(0, start));
    const byteEnd = Buffer.byteLength(text.slice(0, end));
    return {
      byteStart,
      byteEnd,
      sectionHash: hash(input.bytes.subarray(byteStart, byteEnd)),
      locator,
    };
  };
  if (input.bytes.length <= input.maximumBytes)
    return { content: text, sections: [section(0, text.length, "full source")], sourceHash };
  const tree = fromMarkdown(text);
  const headings = tree.children
    .filter((node) => node.type === "heading")
    .map((node) => ({
      start: node.position!.start.offset!,
      depth: node.depth,
      title: text.slice(node.position!.start.offset!, node.position!.end.offset!),
    }));
  const units = [
    { start: 0, depth: 0, title: "preamble" },
    ...headings.filter((heading) => heading.start !== 0),
  ].map((heading, index, all) => ({ ...heading, end: all[index + 1]?.start ?? text.length }));
  const query = terms(input.query);
  const ranked = units
    .map((unit, index) => {
      const body = terms(text.slice(unit.start, unit.end));
      const title = terms(unit.title);
      return {
        index,
        score: [...query].reduce(
          (score, term) => score + (title.has(term) ? 8 : 0) + (body.has(term) ? 1 : 0),
          0,
        ),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (!ranked.length) return null;
  const selected = new Set<number>([0]);
  // Dependency headings are deliberately conservative. Explicit source prose remains unmodified.
  for (const [index, unit] of units.entries())
    if (
      /definition|glossary|condition|exception|scope|주의|조건|예외|정의/iu.test(unit.title) ||
      /\b(?:unless|except|provided that|only if|defined as|refers to)\b|예외|조건|경우에만/iu.test(
        text.slice(unit.start, unit.end),
      )
    )
      selected.add(index);
  const include = (index: number, into: Set<number>) => {
    into.add(index);
    const depth = units[index]!.depth;
    for (let next = index + 1; next < units.length && units[next]!.depth > depth; next++)
      into.add(next);
    let ancestorDepth = depth;
    for (let parent = index - 1; parent >= 0; parent--)
      if (units[parent]!.depth < ancestorDepth) {
        into.add(parent);
        ancestorDepth = units[parent]!.depth;
      }
  };
  const render = (indexes: Set<number>) => {
    const ranges: { start: number; end: number }[] = [];
    for (const index of [...indexes].sort((a, b) => a - b)) {
      const unit = units[index]!;
      const previous = ranges.at(-1);
      if (previous?.end === unit.start) previous.end = unit.end;
      else ranges.push({ start: unit.start, end: unit.end });
    }
    const sections = ranges.map((range) =>
      section(range.start, range.end, `bytes:${Buffer.byteLength(text.slice(0, range.start))}`),
    );
    const content = ranges.map((range) => text.slice(range.start, range.end)).join("\n\n");
    return { content, sections, sourceHash };
  };
  for (const index of [...selected]) if (index !== 0) include(index, selected);
  for (const node of tree.children)
    if (node.type === "definition") {
      const offset = node.position!.start.offset!;
      const index = units.findIndex((unit) => unit.start <= offset && unit.end > offset);
      if (index >= 0) selected.add(index);
    }
  include(ranked[0]!.index, selected);
  let result = render(selected);
  if (Buffer.byteLength(result.content) > input.maximumBytes || result.sections.length > 64)
    return null;
  for (const candidate of ranked.slice(1)) {
    const next = new Set(selected);
    include(candidate.index, next);
    const packed = render(next);
    if (Buffer.byteLength(packed.content) <= input.maximumBytes && packed.sections.length <= 64) {
      for (const index of next) selected.add(index);
      result = packed;
    }
  }
  return result;
}
