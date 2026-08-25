import { parseTree, type Node, type ParseError } from "jsonc-parser";

import { RepositoryKnowledgeError } from "./types.js";

export const JSON_SOURCE_UNIT_ADAPTER = "json-key-pointer-v1+jsonc-parser-3.3.1";

const MAX_JSON_KEY_UNITS = 16_384;
const MAX_JSON_DEPTH = 128;

export interface JsonKeySpan {
  locator: string;
  pointer: string;
  startCharacter: number;
  endCharacter: number;
}

function fail(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_unit_extraction_failed",
    "JSON source units cannot be extracted safely and completely.",
  );
}

function escapedPointerPart(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function validRange(node: Node, sourceLength: number): boolean {
  return (
    Number.isSafeInteger(node.offset) &&
    Number.isSafeInteger(node.length) &&
    node.offset >= 0 &&
    node.length >= 0 &&
    node.offset + node.length <= sourceLength
  );
}

export function extractJsonKeySpans(source: string): JsonKeySpan[] {
  const errors: ParseError[] = [];
  let root: Node | undefined;
  try {
    root = parseTree(source, errors, {
      allowEmptyContent: false,
      allowTrailingComma: false,
      disallowComments: true,
    });
  } catch {
    return fail();
  }
  if (root === undefined || errors.length > 0 || !validRange(root, source.length)) return fail();

  const spans: JsonKeySpan[] = [];
  const stack: Array<{ node: Node; parts: string[] }> = [{ node: root, parts: [] }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.parts.length > MAX_JSON_DEPTH) return fail();

    if (current.node.type === "object") {
      const seen = new Set<string>();
      for (const property of current.node.children ?? []) {
        const [keyNode, valueNode, ...unexpected] = property.children ?? [];
        if (
          property.type !== "property" ||
          unexpected.length > 0 ||
          keyNode?.type !== "string" ||
          typeof keyNode.value !== "string" ||
          valueNode === undefined ||
          !validRange(property, source.length)
        )
          return fail();
        if (seen.has(keyNode.value)) return fail();
        seen.add(keyNode.value);

        const parts = [...current.parts, escapedPointerPart(keyNode.value)];
        if (parts.length > MAX_JSON_DEPTH) return fail();
        const pointer = `/${parts.join("/")}`;
        spans.push({
          locator: `json-pointer:${pointer}`,
          pointer,
          startCharacter: property.offset,
          endCharacter: property.offset + property.length,
        });
        if (spans.length > MAX_JSON_KEY_UNITS) return fail();
        if (valueNode.type === "object" || valueNode.type === "array")
          stack.push({ node: valueNode, parts });
      }
      continue;
    }

    if (current.node.type === "array") {
      for (let index = 0; index < (current.node.children?.length ?? 0); index += 1) {
        const child = current.node.children?.[index];
        if (child !== undefined && (child.type === "object" || child.type === "array")) {
          stack.push({ node: child, parts: [...current.parts, String(index)] });
        }
      }
    }
  }
  return spans;
}
