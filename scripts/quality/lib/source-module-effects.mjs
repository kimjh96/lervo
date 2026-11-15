import ts from "typescript";

/**
 * Finds what a module evaluates at top level that could act outside the values it declares. A
 * test that skips or reorders such a module can observe the difference, so the source module
 * evaluation check reports each one.
 *
 * Only provably inert forms pass: literals, identifiers, member access on inert values, arrow and
 * function expressions, object and array literals of those, templates without tags, operators
 * other than assignment and update, and `as const`, `satisfies`, and other type-only wrappers.
 * A call or `new` passes only with inert arguments and an inert callee: a closed set of unshadowed
 * globals and `node:` functions that build fresh values, a method that does not mutate its inert
 * receiver (iteration callbacks must be inert expressions), any method of a value the expression
 * itself just built, or a repository function the caller reviewed (`reviewedCallee`).
 * Any other call or `new`, and every assignment, update, `await`, tagged template, `delete`, or
 * `yield`, is reported, and so are class decorators, static blocks, `extends` clauses, static
 * field and enum initializers, and namespace statements that are not inert. `export default`
 * passes only a literal, an identifier, or a function or class.
 */

const literalKinds = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);
const inertStatementKinds = new Set([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EmptyStatement,
]);

/** Globals that only build fresh values from their arguments. */
const freshConstructors = new Set([
  "Set",
  "Map",
  "WeakSet",
  "WeakMap",
  "RegExp",
  "TextDecoder",
  "TextEncoder",
  "URL",
  "Error",
]);
const freshFunctions = new Set(["Symbol", "String", "Number", "Boolean", "BigInt"]);
const freshGlobalMembers = new Map([
  ["Object", new Set(["keys", "values", "entries", "fromEntries", "getOwnPropertyNames"])],
  ["Symbol", new Set(["for"])],
  ["Array", new Set(["from", "of", "isArray"])],
  ["String", new Set(["fromCodePoint", "fromCharCode"])],
  ["Number", new Set(["isInteger", "isFinite", "isSafeInteger", "parseInt", "parseFloat"])],
  ["Math", new Set(["ceil", "floor", "round", "trunc", "min", "max", "abs", "pow", "sqrt"])],
  ["JSON", new Set(["stringify", "parse"])],
]);
const freshNodeExports = new Map([
  ["node:crypto", new Set(["createHash"])],
  ["node:async_hooks", new Set(["AsyncLocalStorage"])],
  ["node:path", new Set(["join", "resolve", "dirname", "basename", "relative", "isAbsolute"])],
  ["node:util", new Set(["promisify", "TextDecoder", "TextEncoder"])],
  ["node:url", new Set(["fileURLToPath", "pathToFileURL"])],
]);
/** Methods that read their receiver and return a new value. */
const readingMethods = new Set([
  "map",
  "flatMap",
  "filter",
  "slice",
  "concat",
  "join",
  "includes",
  "some",
  "every",
  "find",
  "findIndex",
  "indexOf",
  "flat",
  "at",
  "toSorted",
  "toReversed",
  "repeat",
  "padStart",
  "padEnd",
  "toUpperCase",
  "toLowerCase",
  "trim",
  "split",
  "replace",
  "replaceAll",
  "startsWith",
  "endsWith",
]);
const iterationMethods = new Set([
  "map",
  "flatMap",
  "filter",
  "some",
  "every",
  "find",
  "findIndex",
]);
const elementMethods = new Set(["find", "at"]);

const hasModifier = (node, kind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((entry) => entry.kind === kind);
const isAssignment = (kind) =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

/** Drops parentheses and type-only wrappers, which evaluate nothing of their own. */
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

const firstOf = (nodes, find) => {
  for (const node of nodes) {
    const found = find(node);
    if (found) return found;
  }
  return null;
};

/** Value bindings that a module imports, and every name it declares at top level. */
function moduleScope(source) {
  const imported = new Map();
  const declared = new Set();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (clause.name) imported.set(clause.name.text, { specifier, name: "default" });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        imported.set(bindings.name.text, { specifier, name: "*" });
      else if (bindings)
        for (const element of bindings.elements)
          if (!element.isTypeOnly)
            imported.set(element.name.text, {
              specifier,
              name: (element.propertyName ?? element.name).text,
            });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) declared.add(declaration.name.text);
    } else if (statement.name && ts.isIdentifier(statement.name)) declared.add(statement.name.text);
  }
  return { imported, declared };
}

function createEffectFinder(source, reviewedCallee) {
  const { imported, declared } = moduleScope(source);
  const isGlobal = (name) => !imported.has(name) && !declared.has(name);

  const computedName = (name) =>
    name && ts.isComputedPropertyName(name) ? effectInExpression(name.expression) : null;

  /** The first node of `expression` that may act when evaluated, or null when it is inert. */
  function effectInExpression(expression) {
    const node = unwrap(expression);
    if (literalKinds.has(node.kind) || ts.isIdentifier(node)) return null;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return null;
    if (ts.isClassExpression(node)) return effectInClass(node);
    if (ts.isTemplateExpression(node))
      return firstOf(node.templateSpans, (span) => effectInExpression(span.expression));
    if (ts.isPropertyAccessExpression(node)) return effectInExpression(node.expression);
    if (ts.isElementAccessExpression(node))
      return effectInExpression(node.expression) ?? effectInExpression(node.argumentExpression);
    if (ts.isArrayLiteralExpression(node))
      return firstOf(node.elements, (element) =>
        ts.isOmittedExpression(element)
          ? null
          : effectInExpression(ts.isSpreadElement(element) ? element.expression : element),
      );
    if (ts.isObjectLiteralExpression(node))
      return firstOf(node.properties, (property) => {
        if (ts.isSpreadAssignment(property)) return effectInExpression(property.expression);
        if (ts.isShorthandPropertyAssignment(property)) return null;
        const name = computedName(property.name);
        if (name) return name;
        return ts.isPropertyAssignment(property) ? effectInExpression(property.initializer) : null;
      });
    if (ts.isPrefixUnaryExpression(node))
      return node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
        ? node
        : effectInExpression(node.operand);
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node))
      return effectInExpression(node.expression);
    if (ts.isBinaryExpression(node))
      return isAssignment(node.operatorToken.kind)
        ? node
        : (effectInExpression(node.left) ?? effectInExpression(node.right));
    if (ts.isConditionalExpression(node))
      return (
        effectInExpression(node.condition) ??
        effectInExpression(node.whenTrue) ??
        effectInExpression(node.whenFalse)
      );
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) return effectInCall(node);
    // `await`, tagged templates, postfix updates, `delete`, `yield`, and the rest.
    return node;
  }

  /** An iteration callback runs now, so its body must be one inert expression. */
  function effectInCallback(argument) {
    const callback = unwrap(argument);
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
      return effectInExpression(argument);
    let body = callback.body;
    if (ts.isBlock(body)) {
      const [only] = body.statements;
      if (body.statements.length !== 1 || !ts.isReturnStatement(only) || !only.expression)
        return callback;
      body = only.expression;
    }
    return effectInExpression(body);
  }

  /**
   * True when `node` builds a value that nothing else can hold yet. An inert call returns a new
   * value, except a method that returns one of its receiver's elements.
   */
  const isFresh = (node) => {
    const value = unwrap(node);
    if (ts.isCallExpression(value))
      return !(
        ts.isPropertyAccessExpression(value.expression) &&
        elementMethods.has(value.expression.name.text)
      );
    return (
      ts.isNewExpression(value) ||
      ts.isArrayLiteralExpression(value) ||
      ts.isObjectLiteralExpression(value)
    );
  };

  function inertCallee(node) {
    const callee = unwrap(node.expression);
    const constructing = ts.isNewExpression(node);
    if (ts.isIdentifier(callee)) {
      const name = callee.text;
      const binding = imported.get(name);
      if (binding)
        return (
          freshNodeExports.get(binding.specifier)?.has(binding.name) === true ||
          reviewedCallee(binding)
        );
      if (declared.has(name)) return reviewedCallee({ local: name });
      return constructing ? freshConstructors.has(name) : freshFunctions.has(name);
    }
    if (!ts.isPropertyAccessExpression(callee) || constructing) return false;
    const receiver = unwrap(callee.expression);
    const method = callee.name.text;
    if (ts.isIdentifier(receiver) && isGlobal(receiver.text)) {
      if (receiver.text === "Object" && method === "freeze")
        return node.arguments.length === 1 && isFresh(node.arguments[0]);
      if (freshGlobalMembers.get(receiver.text)?.has(method)) return true;
    }
    return readingMethods.has(method) || isFresh(receiver);
  }

  /** A call or `new` is inert when its callee builds a fresh value from inert parts. */
  function effectInCall(node) {
    if (!inertCallee(node)) return node;
    const callee = unwrap(node.expression);
    const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression : null;
    if (receiver) {
      const found = effectInExpression(receiver);
      if (found) return found;
    }
    const iterating = receiver !== null && iterationMethods.has(callee.name.text);
    return firstOf(node.arguments ?? [], (argument) =>
      iterating
        ? effectInCallback(argument)
        : effectInExpression(ts.isSpreadElement(argument) ? argument.expression : argument),
    );
  }

  /** Class parts evaluated when the class is defined; instance fields wait for construction. */
  function effectInClass(node) {
    if (hasModifier(node, ts.SyntaxKind.DeclareKeyword)) return null;
    const decorators = ts.getDecorators(node) ?? [];
    if (decorators.length > 0) return decorators[0];
    const heritage = firstOf(node.heritageClauses ?? [], (clause) =>
      clause.token === ts.SyntaxKind.ExtendsKeyword
        ? firstOf(clause.types, (type) => effectInExpression(type.expression))
        : null,
    );
    if (heritage) return heritage;
    return firstOf(node.members, (member) => {
      if (ts.isClassStaticBlockDeclaration(member)) return member;
      if ((ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : []).length > 0)
        return ts.getDecorators(member)[0];
      const name = computedName(member.name);
      if (name) return name;
      return ts.isPropertyDeclaration(member) &&
        hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
        member.initializer
        ? effectInExpression(member.initializer)
        : null;
    });
  }

  function effectInBinding(name) {
    if (ts.isIdentifier(name)) return null;
    return firstOf(name.elements, (element) =>
      ts.isOmittedExpression(element)
        ? null
        : (computedName(element.propertyName) ??
          (element.initializer ? effectInExpression(element.initializer) : null) ??
          effectInBinding(element.name)),
    );
  }

  /** The first node of one top-level or namespace statement that may act, or null. */
  function effectInStatement(statement) {
    if (inertStatementKinds.has(statement.kind)) return null;
    if (ts.isVariableStatement(statement)) {
      if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) return null;
      return firstOf(
        statement.declarationList.declarations,
        (declaration) =>
          effectInBinding(declaration.name) ??
          (declaration.initializer ? effectInExpression(declaration.initializer) : null),
      );
    }
    if (ts.isClassDeclaration(statement)) return effectInClass(statement);
    if (ts.isEnumDeclaration(statement))
      return hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
        ? null
        : firstOf(statement.members, (member) =>
            member.initializer ? effectInExpression(member.initializer) : null,
          );
    if (ts.isModuleDeclaration(statement)) {
      if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword) || !statement.body) return null;
      return ts.isModuleBlock(statement.body)
        ? firstOf(statement.body.statements, effectInStatement)
        : effectInStatement(statement.body);
    }
    if (ts.isExportAssignment(statement)) {
      const value = unwrap(statement.expression);
      if (literalKinds.has(value.kind) || ts.isIdentifier(value)) return null;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return null;
      return ts.isClassExpression(value) ? effectInClass(value) : value;
    }
    return statement;
  }

  return effectInStatement;
}

/**
 * Every top-level statement's first effect, as `{ line, text }` of the acting node.
 * `reviewedCallee({ specifier, name })` or `reviewedCallee({ local })` accepts a repository
 * function or class whose call builds a value without acting elsewhere.
 */
export function topLevelEffects(source, { reviewedCallee = () => false } = {}) {
  const effectInStatement = createEffectFinder(source, reviewedCallee);
  const effects = [];
  for (const statement of source.statements) {
    const node = effectInStatement(statement);
    if (node === null) continue;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    effects.push({ line: line + 1, text: node.getText(source) });
  }
  return effects;
}
