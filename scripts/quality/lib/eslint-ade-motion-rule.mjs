// ADE motion, "Coming and going": an element that a view shows only sometimes either sits in
// `Presence`, which fades it in and out, or names the pattern of the motion catalog that governs
// it in a `{/* motion: <pattern> */}` comment just before it, or inside the braces of an attribute
// such as `trailing={/* motion: Finished status */ a ? <Dot /> : null}`. Nothing comes or goes
// without a decided motion. The ADE tests check that each named pattern is a row of the catalog.

const MOTION_COMMENT = /^\s*motion:\s*\S/u;

function isEmpty(node) {
  return (
    (node?.type === "Literal" && (node.value === null || node.value === false)) ||
    (node?.type === "Identifier" && node.name === "undefined")
  );
}

/** Whether an expression shows its content only sometimes: `a ? b : null` or `a && b`. */
function isConditional(expression) {
  if (expression?.type === "ConditionalExpression")
    return isEmpty(expression.consequent) || isEmpty(expression.alternate);
  return expression?.type === "LogicalExpression" && expression.operator === "&&";
}

const isJsx = (node) => node?.type === "JSXElement" || node?.type === "JSXFragment";

/** Whether a conditional's shown branch is an element, as in `trailing={a ? <Dot /> : null}`. */
function showsElement(expression) {
  return expression.type === "ConditionalExpression"
    ? isJsx(expression.consequent) || isJsx(expression.alternate)
    : isJsx(expression.right);
}

function elementName(node) {
  const name = node?.openingElement?.name;
  return name?.type === "JSXIdentifier" ? name.name : null;
}

/** The sibling before `node` in its parent's children, skipping whitespace. */
function previousSibling(node) {
  const siblings = node.parent?.children ?? [];
  const index = siblings.indexOf(node);
  for (let at = index - 1; at >= 0; at -= 1) {
    const sibling = siblings[at];
    if (sibling.type === "JSXText" && sibling.value.trim() === "") continue;
    return sibling;
  }
  return null;
}

export const declaredMotionRule = {
  meta: {
    type: "problem",
    docs: { description: "Require a decided motion for every element a view shows sometimes." },
    messages: {
      undecided:
        "This element comes and goes without a decided motion. Wrap it in <Presence>, or name its pattern from ADE motion in a {/* motion: <pattern> */} comment just before it.",
    },
    schema: [],
  },
  create(context) {
    const source = context.sourceCode;
    return {
      JSXExpressionContainer(node) {
        if (!isConditional(node.expression)) return;
        const names = (container) =>
          source.getCommentsInside(container).some((comment) => MOTION_COMMENT.test(comment.value));
        if (node.parent?.type === "JSXAttribute") {
          if (showsElement(node.expression) && !names(node))
            context.report({ node, messageId: "undecided" });
          return;
        }
        if (node.parent?.type !== "JSXElement" && node.parent?.type !== "JSXFragment") return;
        if (elementName(node.parent) === "Presence" || names(node)) return;
        const previous = previousSibling(node);
        const declared =
          previous?.type === "JSXExpressionContainer" &&
          previous.expression.type === "JSXEmptyExpression" &&
          names(previous);
        if (!declared) context.report({ node, messageId: "undecided" });
      },
    };
  },
};

export const adeMotionPlugin = {
  meta: { name: "lervo-ade-motion" },
  rules: { "declared-motion": declaredMotionRule },
};
