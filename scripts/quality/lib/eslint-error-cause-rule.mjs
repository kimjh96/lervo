// ADR-0452 section 3: a failure wrapped inside a catch clause must keep the caught error as `cause`.
const functionBoundaries = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function enclosingCatchClause(node) {
  for (let current = node.parent; current !== null && current !== undefined;) {
    if (functionBoundaries.has(current.type)) return null;
    if (current.type === "CatchClause") return current;
    current = current.parent;
  }
  return null;
}

function constructedErrorName(expression) {
  if (expression?.type !== "NewExpression" && expression?.type !== "CallExpression") return null;
  const callee = expression.callee;
  const name =
    callee.type === "Identifier"
      ? callee.name
      : callee.type === "MemberExpression" && !callee.computed
        ? callee.property.name
        : null;
  return typeof name === "string" && /Error$/u.test(name) ? name : null;
}

function propertyName(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
}

function preservesCause(argument, caughtName) {
  if (argument.type === "SpreadElement") return true;
  if (argument.type === "Identifier") return argument.name === caughtName;
  if (argument.type !== "ObjectExpression") return false;
  return argument.properties.some(
    (property) =>
      property.type === "SpreadElement" ||
      (property.type === "Property" && propertyName(property) === "cause"),
  );
}

export const requireCaughtErrorCauseRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require errors constructed and thrown inside a catch clause to carry the caught error as `cause`.",
    },
    schema: [],
    messages: {
      missingCause:
        "Pass the caught error as `cause` when rethrowing {{name}}; a rewrap without it discards the failure chain.",
      discardedCatchParameter:
        "Bind the caught error and pass it as `cause` when throwing {{name}} from this catch clause.",
    },
  },
  create(context) {
    return {
      ThrowStatement(node) {
        const name = constructedErrorName(node.argument);
        if (name === null) return;
        const catchClause = enclosingCatchClause(node);
        if (catchClause === null) return;
        if (catchClause.param === null || catchClause.param === undefined) {
          context.report({ node, messageId: "discardedCatchParameter", data: { name } });
          return;
        }
        const caughtName = catchClause.param.type === "Identifier" ? catchClause.param.name : null;
        if (node.argument.arguments.some((argument) => preservesCause(argument, caughtName))) {
          return;
        }
        context.report({ node, messageId: "missingCause", data: { name } });
      },
    };
  },
};

export const errorCausePlugin = {
  meta: { name: "lervo-error-cause" },
  rules: { "require-caught-error-cause": requireCaughtErrorCauseRule },
};
