// ADE convention, localization: interface text comes from the message catalogs, so JSX carries no
// literal text and no literal user-facing attribute values.
const userFacingAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "label",
  "placeholder",
  "title",
]);

function isStringValue(node) {
  return (
    (node?.type === "Literal" && typeof node.value === "string") || node?.type === "TemplateLiteral"
  );
}

export const noJsxLiteralsRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow literal interface text in JSX; use the message catalog." },
    messages: {
      text: "Move this interface text into the message catalog.",
      attribute: "Move the {{name}} text into the message catalog.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXText(node) {
        if (node.value.trim() !== "") context.report({ node, messageId: "text" });
      },
      JSXExpressionContainer(node) {
        if (node.parent?.type === "JSXAttribute") return;
        if (isStringValue(node.expression)) context.report({ node, messageId: "text" });
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !userFacingAttributes.has(node.name.name)) return;
        const value = node.value;
        const literal =
          value?.type === "Literal" ||
          (value?.type === "JSXExpressionContainer" && isStringValue(value.expression));
        if (literal)
          context.report({ node, messageId: "attribute", data: { name: node.name.name } });
      },
    };
  },
};

export const jsxLiteralPlugin = {
  meta: { name: "lervo-jsx-literal" },
  rules: { "no-jsx-literals": noJsxLiteralsRule },
};
