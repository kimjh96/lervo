import { parse, type ParserPlugin } from "@babel/parser";
import { extname } from "node:path";

import { RepositoryKnowledgeError } from "./types.js";

export const JAVASCRIPT_SOURCE_UNIT_ADAPTER = "javascript-symbol-v1+babel-parser-7.29.8";

const MAX_SYMBOL_UNITS = 16_384;
const MAX_SYMBOL_DEPTH = 128;
const simpleIdentifier = /^[A-Za-z_$][\w$]*$/u;

interface AstNode {
  type: string;
  start?: number | null;
  end?: number | null;
  name?: string;
  value?: unknown;
  id?: AstNode | null;
  key?: AstNode | null;
  argument?: AstNode | null;
  left?: AstNode | null;
  declaration?: AstNode | null;
  body?: AstNode | AstNode[] | null;
  declarations?: AstNode[];
  elements?: Array<AstNode | null>;
  properties?: AstNode[];
  members?: AstNode[];
  children?: AstNode[];
  computed?: boolean;
}

export interface JavaScriptSymbolSpan {
  locator: string;
  qualifiedName: string;
  startCharacter: number;
  endCharacter: number;
}

function fail(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_unit_extraction_failed",
    "JavaScript and TypeScript source units cannot be extracted safely and completely.",
  );
}

function range(node: AstNode, sourceLength: number): { start: number; end: number } | undefined {
  if (
    !Number.isSafeInteger(node.start) ||
    !Number.isSafeInteger(node.end) ||
    (node.start ?? -1) < 0 ||
    (node.end ?? sourceLength + 1) < (node.start ?? 0) ||
    (node.end ?? sourceLength + 1) > sourceLength
  )
    return undefined;
  return { start: node.start as number, end: node.end as number };
}

function name(node: AstNode | null | undefined): string | undefined {
  if (node?.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node?.type === "PrivateName") {
    const identifier = node.id;
    return identifier?.type === "Identifier" && typeof identifier.name === "string"
      ? `#${identifier.name}`
      : undefined;
  }
  if (
    (node?.type === "StringLiteral" || node?.type === "NumericLiteral") &&
    (typeof node.value === "string" || typeof node.value === "number")
  ) {
    return String(node.value);
  }
  return undefined;
}

function bindingNames(node: AstNode | null | undefined): string[] {
  const output: string[] = [];
  const stack = node === null || node === undefined ? [] : [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.type === "Identifier" && typeof current.name === "string") {
      output.push(current.name);
      continue;
    }
    if (current.type === "RestElement") {
      if (current.argument !== null && current.argument !== undefined) stack.push(current.argument);
      continue;
    }
    if (current.type === "AssignmentPattern") {
      if (current.left !== null && current.left !== undefined) stack.push(current.left);
      continue;
    }
    if (current.type === "ObjectPattern") {
      for (const property of current.properties ?? []) {
        if (property.type === "RestElement") {
          if (property.argument !== null && property.argument !== undefined)
            stack.push(property.argument);
        } else if (property.value !== null && typeof property.value === "object") {
          stack.push(property.value as AstNode);
        }
      }
      continue;
    }
    if (current.type === "ArrayPattern") {
      for (const element of current.elements ?? []) if (element !== null) stack.push(element);
    }
  }
  return [...new Set(output)].sort();
}

function pointerPart(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function locator(parts: string[]): string {
  return parts.length === 1 && parts[0] !== "default" && simpleIdentifier.test(parts[0] ?? "")
    ? `declaration:${parts[0]}`
    : `symbol:/${parts.map(pointerPart).join("/")}`;
}

function statementList(node: AstNode | AstNode[] | null | undefined): AstNode[] {
  if (Array.isArray(node)) return node;
  if (node?.type === "Program" || node?.type === "TSModuleBlock")
    return Array.isArray(node.body) ? node.body : [];
  return [];
}

export function extractJavaScriptSymbolSpans(source: string, path: string): JavaScriptSymbolSpan[] {
  const extension = extname(path).toLowerCase();
  const typescript =
    extension === ".ts" || extension === ".tsx" || extension === ".mts" || extension === ".cts";
  // Declaration files (`.d.ts`, `.d.mts`, `.d.cts`) are ambient: `export const X: T;` has no
  // initializer. Parsing them as implementation files rejected valid declarations.
  const declaration = typescript && /\.d\.[cm]?ts$/iu.test(path);
  const jsx =
    extension === ".js" ||
    extension === ".jsx" ||
    extension === ".mjs" ||
    extension === ".cjs" ||
    extension === ".tsx";
  const sourceType =
    extension === ".mjs" || extension === ".mts"
      ? "module"
      : extension === ".cjs"
        ? "commonjs"
        : "unambiguous";
  const parseProgram = (dts: boolean): AstNode =>
    parse(source, {
      attachComment: false,
      errorRecovery: false,
      plugins: [
        ...(typescript ? [["typescript", { dts }] satisfies ParserPlugin] : []),
        ...(jsx ? ["jsx" as const] : []),
        "decorators-legacy",
      ],
      ranges: true,
      sourceType,
      tokens: false,
    }).program as unknown as AstNode;
  let program: AstNode;
  try {
    program = parseProgram(declaration);
  } catch {
    // A declaration file that also holds implementation bodies is rejected in `dts` mode; it
    // keeps the implementation parse it always had.
    try {
      if (!declaration) return fail();
      program = parseProgram(false);
    } catch {
      return fail();
    }
  }

  const spans = new Map<string, JavaScriptSymbolSpan>();
  const work: Array<{
    node: AstNode;
    prefix: string[];
    rangeNode?: AstNode;
    fallbackName?: string;
  }> = statementList(program).map((node) => ({ node, prefix: [] }));
  const add = (parts: string[], node: AstNode): void => {
    if (parts.length === 0 || parts.length > MAX_SYMBOL_DEPTH) return fail();
    const coordinates = range(node, source.length);
    if (coordinates === undefined) return fail();
    const unitLocator = locator(parts);
    const existing = spans.get(unitLocator);
    spans.set(unitLocator, {
      locator: unitLocator,
      qualifiedName: parts.join("."),
      startCharacter: Math.min(existing?.startCharacter ?? coordinates.start, coordinates.start),
      endCharacter: Math.max(existing?.endCharacter ?? coordinates.end, coordinates.end),
    });
    if (spans.size > MAX_SYMBOL_UNITS) return fail();
  };

  while (work.length > 0) {
    const current = work.pop();
    if (current === undefined) break;
    if (current.prefix.length > MAX_SYMBOL_DEPTH) return fail();
    const node = current.node;
    const effectiveRange = current.rangeNode ?? node;

    if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
      if (node.declaration !== null && node.declaration !== undefined) {
        work.push({
          node: node.declaration,
          prefix: current.prefix,
          rangeNode: effectiveRange,
          ...(node.type === "ExportDefaultDeclaration" ? { fallbackName: "default" } : {}),
        });
      } else if (node.type === "ExportDefaultDeclaration") {
        add([...current.prefix, "default"], effectiveRange);
      }
      continue;
    }

    if (node.type === "VariableDeclaration") {
      for (const declaration of node.declarations ?? []) {
        for (const binding of bindingNames(declaration.id))
          add([...current.prefix, binding], effectiveRange);
      }
      continue;
    }

    if (
      node.type === "FunctionDeclaration" ||
      node.type === "TSDeclareFunction" ||
      node.type === "TSTypeAliasDeclaration"
    ) {
      const symbolName = name(node.id) ?? current.fallbackName;
      if (symbolName !== undefined) add([...current.prefix, symbolName], effectiveRange);
      continue;
    }

    if (
      node.type === "ClassDeclaration" ||
      node.type === "TSInterfaceDeclaration" ||
      node.type === "TSEnumDeclaration"
    ) {
      const symbolName = name(node.id) ?? current.fallbackName;
      if (symbolName === undefined) continue;
      const parts = [...current.prefix, symbolName];
      add(parts, effectiveRange);
      const body = node.body;
      const members = Array.isArray(body)
        ? body
        : body !== null && typeof body === "object"
          ? ((body.body as AstNode[] | undefined) ?? body.members ?? [])
          : (node.members ?? []);
      for (const member of members) {
        const memberName = name(member.key ?? member.id);
        if (memberName !== undefined) add([...parts, memberName], member);
      }
      continue;
    }

    if (node.type === "TSModuleDeclaration") {
      const symbolName = name(node.id) ?? current.fallbackName;
      if (symbolName === undefined) continue;
      const parts = [...current.prefix, symbolName];
      add(parts, effectiveRange);
      const body = node.body;
      if (!Array.isArray(body) && body?.type === "TSModuleDeclaration")
        work.push({ node: body, prefix: parts });
      else
        for (const statement of statementList(body)) work.push({ node: statement, prefix: parts });
    }
  }

  return [...spans.values()];
}
