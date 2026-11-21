import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import ts from "typescript";

/*
 * ADR-0608: every provider output schema is built through `providerOutputSchema`, which brands it
 * and checks it at runtime; this scan keeps any other construction out of production source. It
 * parses with the TypeScript compiler, so template literals, regular expressions, shorthand
 * properties, spreads, `Object.assign` and schemas without siblings are read exactly.
 */

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);
const excludedSegments = new Set(["node_modules", "dist", "test", "tests", "fixtures"]);

/** Words that name a value a model would copy back, as the last word of a property name. */
const COPIED_WORDS = new Set([
  "hash",
  "digest",
  "sha",
  "sha1",
  "sha256",
  "sha512",
  "fingerprint",
  "checksum",
  "revision",
  "oid",
  "ref",
]);

/** The same rule as `providerHashLikeName` in `@lervo/schemas`: `planHash`, `head_ref`, `oids`. */
export function hashLikeName(name) {
  const last = name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase())
    .at(-1);
  return (
    last !== undefined &&
    (COPIED_WORDS.has(last) || COPIED_WORDS.has(last.replace(/(?:es|s)$/u, "")))
  );
}

/** A literal value that is a hash, which a schema must never offer in `enum` or `const`. */
export const hashLikeValue = /^(?:sha(?:1|256|384|512):)?[0-9a-f]{40,128}$/iu;

function isProductionSource(path) {
  if (path.split("/").some((segment) => excludedSegments.has(segment))) return false;
  if (/\.(?:test|spec)\.[^.]+$/u.test(path) || path.endsWith(".d.ts")) return false;
  return sourceExtensions.has(path.slice(path.lastIndexOf(".")));
}

async function collect(root, path, files) {
  let stat;
  try {
    stat = await lstat(join(root, path));
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (isProductionSource(path)) files.push(path);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = relative(root, join(root, path, entry.name))
      .split(sep)
      .join("/");
    if (entry.isDirectory()) {
      if (!excludedSegments.has(entry.name)) await collect(root, child, files);
    } else if (entry.isFile() && isProductionSource(child)) files.push(child);
  }
}

/** A property's name when the source states it, or null for a computed one. */
function propertyName(node) {
  const name = node.name;
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/** The expression under `as const`, `satisfies`, a type assertion or parentheses. */
function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

const isHelperCall = (node) =>
  ts.isCallExpression(node) &&
  ((ts.isIdentifier(node.expression) && node.expression.text === "providerOutputSchema") ||
    (ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "providerOutputSchema"));

const member = (object, name) =>
  object.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyName(property) === name,
  );

/**
 * Every issue in one file's source: `{ name, line, helper }`, where `helper` says whether the
 * schema is inside a `providerOutputSchema(...)` call. Hash-like names, hash values, Zod, and
 * every shape the scan cannot read are issues; so is any schema outside the helper.
 */
export function findProviderSchemaIssues(code, fileName = "source.ts") {
  const kind =
    fileName.endsWith(".ts") || fileName.endsWith(".mts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  // The nearest enclosing named declaration, which a reviewed exception names.
  const symbol = (node) => {
    for (let current = node.parent; current !== undefined; current = current.parent)
      if (
        (ts.isVariableDeclaration(current) ||
          ts.isFunctionDeclaration(current) ||
          ts.isMethodDeclaration(current) ||
          ts.isClassDeclaration(current) ||
          ts.isPropertyDeclaration(current)) &&
        current.name !== undefined &&
        ts.isIdentifier(current.name)
      )
        return current.name.text;
    return "<module>";
  };
  const report = (name, node, helper) =>
    found.push({ name, line: line(node), helper, symbol: symbol(node) });
  const visit = (node, helper) => {
    const inside = helper || isHelperCall(node);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (/^zod(?:\/|$)/u.test(node.moduleSpecifier.text)) report("<zod>", node, inside);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      /^zod(?:\/|$)/u.test(node.arguments[0].text)
    )
      report("<zod>", node, inside);
    else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" &&
      node.expression.name.text === "assign" &&
      node.arguments.some(
        (argument) =>
          ts.isObjectLiteralExpression(unwrap(argument)) &&
          member(unwrap(argument), "properties") !== undefined,
      )
    )
      report("<unchecked Object.assign schema>", node, inside);
    if (ts.isObjectLiteralExpression(node)) {
      const properties = member(node, "properties");
      if (properties !== undefined) {
        if (!inside) report("<schema outside providerOutputSchema>", node, inside);
        if (node.properties.some((property) => ts.isSpreadAssignment(property)))
          report("<unchecked spread schema>", node, inside);
        const value = ts.isShorthandPropertyAssignment(properties)
          ? properties.name
          : unwrap(properties.initializer);
        if (!ts.isObjectLiteralExpression(value))
          report("<properties built at runtime>", properties, inside);
        else
          for (const property of value.properties) {
            if (ts.isSpreadAssignment(property)) {
              report(`<unchecked ${property.getText(source).slice(0, 40)}>`, property, inside);
              continue;
            }
            const name = propertyName(property);
            if (name === null)
              report(`<unchecked ${property.getText(source).slice(0, 40)}>`, property, inside);
            else if (hashLikeName(name)) report(name, property, inside);
          }
        const required = member(node, "required");
        if (required !== undefined) {
          const list = ts.isShorthandPropertyAssignment(required)
            ? required.name
            : unwrap(required.initializer);
          if (
            !ts.isArrayLiteralExpression(list) ||
            !list.elements.every((element) => ts.isStringLiteralLike(unwrap(element)))
          )
            report("<required built at runtime>", required, inside);
          else
            for (const element of list.elements)
              if (hashLikeName(unwrap(element).text)) report(unwrap(element).text, element, inside);
        }
      }
    }
    // A literal `enum` or `const` value that is a hash, wherever a schema could carry it.
    if (
      ts.isPropertyAssignment(node) &&
      ["enum", "const", "default", "examples", "pattern"].includes(propertyName(node) ?? "")
    ) {
      const value = unwrap(node.initializer);
      const items = ts.isArrayLiteralExpression(value) ? value.elements : [value];
      for (const item of items) {
        const literal = unwrap(item);
        if (ts.isStringLiteralLike(literal) && hashLikeValue.test(literal.text))
          report(`<hash value ${literal.text.slice(0, 12)}…>`, literal, inside);
      }
    }
    // The brand's key belongs to the helper alone; written anywhere else, it forges the brand.
    if (
      (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
      node.text === "__providerOutputSchema" &&
      !fileName.endsWith("packages/schemas/src/provider-output-schema.ts")
    )
      report("<forged ProviderOutputSchema brand>", node, inside);
    // A reference-kind mark lets the source check skip a value; only the helper may write one.
    if (
      ts.isStringLiteralLike(node) &&
      node.text === "x-lervo-ref-kind" &&
      !fileName.endsWith("packages/schemas/src/provider-output-schema.ts")
    )
      report("<reference kind mark outside providerReferenceEnum>", node, inside);
    // The brand comes only from the helper: a cast, or a parsed `any` handed straight to a
    // provider schema field, would skip it.
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      /\bProviderOutputSchema\b/u.test(node.type.getText(source)) &&
      !fileName.endsWith("packages/schemas/src/provider-output-schema.ts")
    )
      report("<cast to ProviderOutputSchema>", node, inside);
    if (
      ts.isPropertyAssignment(node) &&
      ["schema", "structuredOutputSchema", "outputSchema", "responseSchema"].includes(
        propertyName(node) ?? "",
      )
    ) {
      const value = unwrap(node.initializer);
      if (
        ts.isCallExpression(value) &&
        ts.isPropertyAccessExpression(value.expression) &&
        ts.isIdentifier(value.expression.expression) &&
        value.expression.expression.text === "JSON" &&
        value.expression.name.text === "parse"
      )
        report("<schema from JSON.parse>", node, inside);
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, false);
  return found.sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));
}

/** The ways around the brand, refused in a non-provider scope as anywhere else. */
const BRAND_BYPASSES = new Set([
  "<forged ProviderOutputSchema brand>",
  "<cast to ProviderOutputSchema>",
  "<schema from JSON.parse>",
  "<reference kind mark outside providerReferenceEnum>",
]);

/**
 * ADR-0608: checks production source under the scope. A file listed under `constructions` may
 * build schemas outside the helper for a stated reason. A scope under `nonProviderScopes` holds
 * schemas Lervo writes itself, never a provider answer: it is scanned too, but only its schemas
 * inside the helper are held to the provider rules, and a way around the brand is refused there as
 * anywhere else. A name a provider must produce needs an
 * `entries` item with a reason; there are none.
 */
export async function inspectProviderSchemaHashes({ repositoryRoot, allowlist }) {
  const issues = [];
  const files = [];
  for (const path of allowlist.scope) await collect(repositoryRoot, path, files);
  const scopes = allowlist.nonProviderScopes ?? [];
  for (const scope of scopes)
    if (typeof scope.reason !== "string" || scope.reason.trim().length < 10)
      issues.push(`${scope.path} needs a reason in the provider schema allowlist.`);
  // ADR-0608: a reviewed exception names one symbol in one file, never a whole file.
  const constructions = new Map(
    (allowlist.constructions ?? []).map((entry) => [`${entry.path}#${entry.symbol}`, entry]),
  );
  for (const entry of constructions.values()) {
    if (typeof entry.symbol !== "string" || entry.symbol === "")
      issues.push(`${entry.path} needs the symbol it allows in the allowlist.`);
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10)
      issues.push(
        `${entry.path}#${entry.symbol} needs a reason for building schemas in the allowlist.`,
      );
  }
  const usedConstructions = new Set();
  const allowed = new Map();
  for (const entry of allowlist.entries) {
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10)
      issues.push(`${entry.path} needs a reason for ${entry.property} in the allowlist.`);
    allowed.set(`${entry.path}#${entry.property}`, entry);
  }
  const seen = new Set();
  const checked = files.sort();
  for (const path of checked) {
    const nonProvider = scopes.some(
      (scope) => path === scope.path || path.startsWith(`${scope.path}/`),
    );
    const code = await readFile(join(repositoryRoot, path), "utf8");
    for (const { name, line, helper, symbol } of findProviderSchemaIssues(code, path)) {
      // Outside the helper, a non-provider scope or a reviewed symbol is not a provider schema. A
      // way around the brand is refused in a non-provider scope too; the finder lets only the
      // helper's own file name the brand.
      const construction = constructions.has(`${path}#${symbol}`);
      if (construction) usedConstructions.add(`${path}#${symbol}`);
      if (!helper && construction) continue;
      if (!helper && nonProvider && !BRAND_BYPASSES.has(name)) continue;
      if (name === "<zod>") {
        issues.push(
          `${path}:${line} builds schemas with Zod; build provider output schemas with providerOutputSchema (ADR-0608) or list the file with a reason.`,
        );
        continue;
      }
      const key = `${path}#${name}`;
      if (allowed.has(key)) {
        seen.add(key);
        continue;
      }
      issues.push(
        `${path}:${line} asks a provider for ${name}; Lervo binds hashes and identifiers itself (ADR-0608), so build the schema through providerOutputSchema with literal names, or list it with a reason.`,
      );
    }
  }
  for (const [key, entry] of constructions)
    if (!usedConstructions.has(key))
      issues.push(
        `${entry.path}#${entry.symbol} builds no schema any more; remove its allowlist entry.`,
      );
  for (const [key, entry] of allowed)
    if (!seen.has(key))
      issues.push(
        `${entry.path} no longer asks for ${entry.property}; remove its allowlist entry.`,
      );
  return { files: checked, issues };
}
