// ADR-0608: a value typed `any` satisfies every type, so it would carry a schema past the brand that
// proves it went through `providerOutputSchema`. Where the expected type carries that brand, itself
// or as a field such as `ProviderJsonRequest.responseContract.schema`, an `any` value fails.
import ts from "typescript";

const BRAND = "__providerOutputSchema";
/** How many fields deep an expected type is searched for the brand. */
const DEPTH = 2;

function carriesBrand(checker, type, depth, seen) {
  if (type === undefined || type === null || seen.has(type)) return false;
  seen.add(type);
  if (type.flags & ts.TypeFlags.TypeParameter)
    return carriesBrand(checker, checker.getBaseConstraintOfType(type), depth, seen);
  if (type.isUnionOrIntersection())
    return type.types.some((member) => carriesBrand(checker, member, depth, seen));
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  if (type.getProperty(BRAND) !== undefined) return true;
  if (depth === 0) return false;
  return type
    .getProperties()
    .some((symbol) => carriesBrand(checker, checker.getTypeOfSymbol(symbol), depth - 1, seen));
}

export const noAnyProviderSchemaRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow an `any` value where a provider output schema, or a request that carries one, is expected.",
    },
    schema: [],
    messages: {
      anySchema:
        "This value is `any`, so it skips the provider schema brand. Build the schema with providerOutputSchema(...) or give the value its type.",
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (services?.program === undefined || services.program === null) return {};
    const checker = services.program.getTypeChecker();
    const anyAt = (tsNode) => (checker.getTypeAtLocation(tsNode).flags & ts.TypeFlags.Any) !== 0;
    const report = (node, expected) => {
      if (carriesBrand(checker, expected, DEPTH, new Set()))
        context.report({ node, messageId: "anySchema" });
    };
    const check = (node) => {
      if (node === null || node === undefined || node.type === "SpreadElement") return;
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      if (tsNode === undefined || !anyAt(tsNode)) return;
      report(node, checker.getContextualType(tsNode));
    };
    // A generic parameter inferred from an `any` argument becomes `any` itself, so an argument is
    // also held to the parameter type as declared, constraint and all.
    const checkArguments = (call) => {
      const tsCall = services.esTreeNodeToTSNodeMap.get(call);
      const declaration =
        tsCall === undefined ? undefined : checker.getResolvedSignature(tsCall)?.getDeclaration();
      call.arguments.forEach((argument, index) => {
        if (argument.type === "SpreadElement") return;
        const tsNode = services.esTreeNodeToTSNodeMap.get(argument);
        if (tsNode === undefined || !anyAt(tsNode)) return;
        const parameters = declaration?.parameters ?? [];
        const parameter = parameters[Math.min(index, parameters.length - 1)];
        const declared = parameter === undefined ? undefined : checker.getTypeAtLocation(parameter);
        if (carriesBrand(checker, declared, DEPTH, new Set())) report(argument, declared);
        else report(argument, checker.getContextualType(tsNode));
      });
    };
    return {
      CallExpression: checkArguments,
      NewExpression: checkArguments,
      Property: (node) => check(node.value),
      VariableDeclarator: (node) => check(node.init),
      ReturnStatement: (node) => check(node.argument),
      AssignmentExpression: (node) => check(node.right),
      PropertyDefinition: (node) => check(node.value),
      ArrowFunctionExpression: (node) => {
        if (node.body.type !== "BlockStatement") check(node.body);
      },
    };
  },
};

export const providerSchemaPlugin = {
  meta: { name: "lervo-provider-schema" },
  rules: { "no-any-provider-schema": noAnyProviderSchemaRule },
};
