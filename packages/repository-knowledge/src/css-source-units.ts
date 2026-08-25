import postcss, { type ChildNode, type Container } from "postcss";

import { RepositoryKnowledgeError } from "./types.js";

export const CSS_SOURCE_UNIT_ADAPTER = "css-symbol-v1+postcss-8.5.26";

export interface CssSymbolSpan {
  locator: string;
  title: string;
  startCharacter: number;
  endCharacter: number;
}

interface Candidate extends Omit<CssSymbolSpan, "locator"> {
  baseLocator: string;
}

const MAX_NODES = 16_384;
const MAX_DEPTH = 128;
const MAX_LABEL_CHARACTERS = 2_048;
const namedAtRules = new Set([
  "container",
  "custom-media",
  "keyframes",
  "-webkit-keyframes",
  "layer",
  "media",
  "property",
  "scope",
  "supports",
]);

function fail(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_unit_extraction_failed",
    "CSS source units cannot be extracted completely under the fixed parser contract.",
  );
}

function pointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function normalized(value: string): string {
  const result = value.trim().replace(/\s+/gu, " ");
  if (result.length === 0 || result.length > MAX_LABEL_CHARACTERS) return fail();
  return result;
}

function range(
  node: ChildNode,
  contentLength: number,
): { startCharacter: number; endCharacter: number } {
  const startCharacter = node.source?.start?.offset;
  const endCharacter = node.source?.end?.offset;
  if (
    !Number.isSafeInteger(startCharacter) ||
    !Number.isSafeInteger(endCharacter) ||
    startCharacter === undefined ||
    endCharacter === undefined ||
    startCharacter < 0 ||
    endCharacter <= startCharacter ||
    endCharacter > contentLength
  )
    return fail();
  return { startCharacter, endCharacter };
}

function locator(ancestors: readonly string[], kind: string, identity: string): string {
  const segments = [...ancestors, `${kind}:${normalized(identity)}`].map(pointer);
  const result = `css:/${segments.join("/")}`;
  if (result.length > 8_192) return fail();
  return result;
}

export function extractCssSymbolSpans(content: string): CssSymbolSpan[] {
  let root;
  try {
    root = postcss.parse(content, { from: undefined });
  } catch {
    return fail();
  }
  const candidates: Candidate[] = [];
  let nodeCount = 0;
  const visit = (container: Container, ancestors: readonly string[], depth: number): void => {
    if (depth > MAX_DEPTH) return fail();
    for (const node of container.nodes ?? []) {
      nodeCount += 1;
      if (nodeCount > MAX_NODES) return fail();
      if (node.type === "rule") {
        const identity = normalized(node.selector);
        const baseLocator = locator(ancestors, "rule", identity);
        candidates.push({
          baseLocator,
          title: `CSS rule ${identity}`,
          ...range(node, content.length),
        });
        visit(node, [...ancestors, `rule:${identity}`], depth + 1);
        continue;
      }
      if (node.type === "atrule") {
        const name = node.name.toLocaleLowerCase();
        const identity =
          node.params.trim() === "" ? `@${name}` : `@${name} ${normalized(node.params)}`;
        if (namedAtRules.has(name)) {
          candidates.push({
            baseLocator: locator(ancestors, "at-rule", identity),
            title: `CSS ${identity}`,
            ...range(node, content.length),
          });
        }
        if (node.nodes !== undefined) visit(node, [...ancestors, `at-rule:${identity}`], depth + 1);
        continue;
      }
      if (node.type === "decl" && node.prop.startsWith("--")) {
        const identity = normalized(node.prop);
        candidates.push({
          baseLocator: locator(ancestors, "custom-property", identity),
          title: `CSS custom property ${identity}`,
          ...range(node, content.length),
        });
      }
    }
  };
  visit(root, [], 1);
  const counts = new Map<string, number>();
  for (const item of candidates)
    counts.set(item.baseLocator, (counts.get(item.baseLocator) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  return candidates.map(({ baseLocator, ...item }) => {
    const occurrence = occurrences.get(baseLocator) ?? 0;
    occurrences.set(baseLocator, occurrence + 1);
    return {
      ...item,
      locator:
        counts.get(baseLocator) === 1 ? baseLocator : `${baseLocator}/occurrence=${occurrence}`,
    };
  });
}
