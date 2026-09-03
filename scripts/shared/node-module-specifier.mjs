import { builtinModules } from "node:module";

const builtinModuleNames = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export function isBuiltinModuleSpecifier(specifier, knownBuiltinModules = builtinModuleNames) {
  return specifier.startsWith("node:") || knownBuiltinModules.has(specifier);
}
