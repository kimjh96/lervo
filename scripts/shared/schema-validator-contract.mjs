export const schemaValidatorCompilerOptions = Object.freeze({
  allErrors: true,
  strict: true,
  inlineRefs: true,
  loopEnum: 3,
  loopRequired: 1,
  code: Object.freeze({ optimize: 2 }),
});

export function validSchemaValidatorManifest(manifest) {
  return (
    manifest !== null &&
    typeof manifest === "object" &&
    manifest.schemaVersion === 1 &&
    manifest.generatorVersion === 2 &&
    Number.isSafeInteger(manifest.schemaCount) &&
    manifest.schemaCount >= 1 &&
    manifest.schemaCount <= 1024 &&
    typeof manifest.toolchain?.ajv === "string" &&
    typeof manifest.toolchain?.esbuild === "string" &&
    Array.isArray(manifest.runtimeDependencies) &&
    manifest.runtimeDependencies.length <= 16 &&
    manifest.runtimeDependencies.every(
      (value) => typeof value === "string" && /^(?:@[^/]+\/)?[^/@]+@\d+\.\d+\.\d+$/.test(value),
    ) &&
    JSON.stringify(manifest.runtimeDependencies) ===
      JSON.stringify([...new Set(manifest.runtimeDependencies)].sort()) &&
    JSON.stringify(manifest.compilerOptions) === JSON.stringify(schemaValidatorCompilerOptions)
  );
}
