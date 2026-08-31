import { createHash } from "node:crypto";

const defaultMaximumSections = 2;
const defaultTargetBytes = 3_000;

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function terms(value) {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("und")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).map((term) => term.match(/^([a-z][a-z0-9]*)(?:[가-힣]+)$/u)?.[1] ?? term);
}

export function lexicalTermCoverage(value, query) {
  const valueTerms = new Set(terms(value));
  return [...new Set(terms(query))].filter((term) => valueTerms.has(term)).length;
}

function sections(markdown) {
  const starts = [...markdown.matchAll(/^#{1,6}\s+.+$/gmu)].map((match) => ({
    index: match.index,
    heading: match[0],
  }));
  const result = [];
  if (starts.length === 0 || starts[0].index > 0) {
    const end = starts[0]?.index ?? markdown.length;
    const content = markdown.slice(0, end).trim();
    if (content.length > 0) result.push({ id: "preamble", heading: "", content, order: 0 });
  }
  starts.forEach((start, index) => {
    const content = markdown.slice(start.index, starts[index + 1]?.index ?? markdown.length).trim();
    if (content.length > 0) {
      result.push({
        id: `section-${index + 1}`,
        heading: start.heading,
        content,
        order: result.length,
      });
    }
  });
  return result;
}

function scoreSection(section, queryTerms) {
  const bodyTerms = terms(section.content);
  const body = new Map();
  for (const term of bodyTerms) body.set(term, (body.get(term) ?? 0) + 1);
  const heading = new Set(terms(section.heading));
  let coverage = 0;
  let headingCoverage = 0;
  let frequency = 0;
  for (const term of queryTerms) {
    const count = body.get(term) ?? 0;
    if (count > 0) coverage += 1;
    if (heading.has(term)) headingCoverage += 1;
    frequency += Math.min(count, 4);
  }
  return coverage * 100_000 + headingCoverage * 10_000 + frequency * 100;
}

export function selectSectionEvidence(source, query, options = {}) {
  const maximumSections = options.maximumSections ?? defaultMaximumSections;
  const targetBytes = options.targetBytes ?? defaultTargetBytes;
  const queryTerms = [...new Set(terms(query))];
  const candidates = sections(source.text)
    .map((section) => ({ ...section, score: scoreSection(section, queryTerms) }))
    .sort((left, right) => right.score - left.score || left.order - right.order);
  const selected = [];
  let selectedBytes = 0;
  for (const candidate of candidates) {
    if (selected.length >= maximumSections) break;
    const bytes = Buffer.byteLength(candidate.content, "utf8");
    if (candidate.score === 0 && selected.length > 0) continue;
    if (selected.length > 0 && selectedBytes + bytes > targetBytes) continue;
    selected.push(candidate);
    selectedBytes += bytes;
  }
  if (selected.length === 0 && candidates[0] !== undefined) selected.push(candidates[0]);
  selected.sort((left, right) => left.order - right.order);
  const content = selected.map((section) => section.content).join("\n\n");
  return {
    content,
    contentHash: digest(content),
    byteCount: Buffer.byteLength(content, "utf8"),
    scope: { kind: "sections", sections: selected.map((section) => section.id) },
    sourceContentHash: source.contentHash,
    selectionScore: Math.max(0, ...selected.map((section) => section.score)),
  };
}
