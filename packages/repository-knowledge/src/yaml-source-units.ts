import { isMap, isNode, isScalar, isSeq, parseAllDocuments, type Node } from "yaml";

import { RepositoryKnowledgeError } from "./types.js";

export const YAML_SOURCE_UNIT_ADAPTER = "yaml-key-pointer-v1+yaml-2.9.0";

const MAX_YAML_KEY_UNITS = 16_384;
const MAX_YAML_DEPTH = 128;

export interface YamlKeySpan {
  locator: string;
  pointer: string;
  startCharacter: number;
  endCharacter: number;
}

function fail(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_unit_extraction_failed",
    "YAML source units cannot be extracted safely and completely.",
  );
}

function escapedPointerPart(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function extractYamlKeySpans(source: string): YamlKeySpan[] {
  let documents;
  try {
    documents = parseAllDocuments(source, {
      keepSourceTokens: true,
      resolveKnownTags: false,
      schema: "core",
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
    });
  } catch {
    return fail();
  }
  if (documents.some((document) => document.errors.length > 0 || document.warnings.length > 0))
    return fail();

  const spans: YamlKeySpan[] = [];
  for (const [documentIndex, document] of documents.entries()) {
    const root = document.contents;
    if (root === null) continue;
    const stack: Array<{ node: Node; parts: string[] }> = [{ node: root, parts: [] }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      if (current.parts.length > MAX_YAML_DEPTH) return fail();

      if (isMap(current.node)) {
        for (let index = current.node.items.length - 1; index >= 0; index -= 1) {
          const pair = current.node.items[index];
          if (
            pair === undefined ||
            !isScalar(pair.key) ||
            typeof pair.key.value !== "string" ||
            pair.key.range === null ||
            pair.key.range === undefined
          )
            return fail();
          const keyRange = pair.key.range;
          const parts = [...current.parts, escapedPointerPart(pair.key.value)];
          if (parts.length > MAX_YAML_DEPTH) return fail();
          const pointer = `/${parts.join("/")}`;
          const valueRange = isNode(pair.value) ? pair.value.range : undefined;
          spans.push({
            locator: `yaml-pointer:doc=${documentIndex}:${pointer}`,
            pointer,
            startCharacter: keyRange[0],
            endCharacter: valueRange?.[2] ?? keyRange[2],
          });
          if (spans.length > MAX_YAML_KEY_UNITS) return fail();
          if (pair.value !== null && (isMap(pair.value) || isSeq(pair.value))) {
            stack.push({ node: pair.value, parts });
          }
        }
        continue;
      }

      if (isSeq(current.node)) {
        for (let index = current.node.items.length - 1; index >= 0; index -= 1) {
          const child = current.node.items[index];
          if (child !== null && (isMap(child) || isSeq(child))) {
            stack.push({ node: child, parts: [...current.parts, String(index)] });
          }
        }
      }
    }
  }
  return spans;
}
