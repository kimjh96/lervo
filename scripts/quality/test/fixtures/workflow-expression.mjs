/**
 * Evaluates the small GitHub Actions expression subset that workflow tests use for job and step
 * conditions: context lookups, string literals, `==`, `!=`, `!`, `&&`, `||`, parentheses, and
 * status functions supplied by the caller. Missing context values compare as empty strings.
 */
const TOKEN =
  /\s*('(?:[^']|'')*'|&&|\|\||==|!=|!|\(|\)|[A-Za-z_][\w-]*(?:\.[\w-]+)*\(\)|[A-Za-z_][\w-]*(?:\.[\w-]+)*)/uy;

function tokenize(source) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.trimEnd().length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) throw new Error(`Unsupported expression at ${start}: ${source}`);
    tokens.push(match[1]);
  }
  return tokens;
}

const truthy = (value) => value !== "" && value !== false && value !== null && value !== undefined;
const unwrap = (expression) =>
  String(expression)
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/u, "$1");

export function evaluateWorkflowValue(expression, context) {
  const tokens = tokenize(unwrap(expression));
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  function primary() {
    const token = next();
    if (token === "(") {
      const value = disjunction();
      if (next() !== ")") throw new Error("Unbalanced parentheses");
      return value;
    }
    if (token === "!") return !truthy(primary());
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token.endsWith("()")) return context.functions[token.slice(0, -2)]();
    return token.split(".").reduce((value, key) => value?.[key], context) ?? "";
  }
  function comparison() {
    let left = primary();
    while (peek() === "==" || peek() === "!=") {
      const operator = next();
      const right = primary();
      left = operator === "==" ? left === right : left !== right;
    }
    return left;
  }
  function conjunction() {
    let left = comparison();
    while (peek() === "&&") {
      next();
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  function disjunction() {
    let left = conjunction();
    while (peek() === "||") {
      next();
      const right = conjunction();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  const value = disjunction();
  if (position !== tokens.length) throw new Error(`Unexpected token ${peek()}`);
  return value;
}

/** Whether a job or step runs; without a status function GitHub requires earlier success. */
export function workflowConditionHolds(condition, context, { earlierSucceeded = true } = {}) {
  if (condition === undefined) return earlierSucceeded;
  const explicitStatus = /\b(?:success|failure|cancelled|always)\(\)/u.test(String(condition));
  return (explicitStatus || earlierSucceeded) && truthy(evaluateWorkflowValue(condition, context));
}
