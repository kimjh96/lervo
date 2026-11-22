export const coordinateDataVersions = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

export const sharedRuntimeSchemaNames = Object.freeze([
  "contextQualityBindings",
  "contextQualityEvidence",
  "contextQualityIngress",
  "contextQualityPlan",
  "contextQualityPreparedEventPayload",
  "contextQualityRequest",
  "contextQualityVerification",
  "contextQualityVerifiedEventPayload",
  "event",
  "eventReaderCapabilities",
  "eventWriterCoordinate",
  "project",
]);

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
    manifest.generatorVersion === 4 &&
    JSON.stringify(manifest.coordinateData?.versions) === JSON.stringify(coordinateDataVersions) &&
    /^sha256:[a-f0-9]{64}$/u.test(manifest.coordinateData?.contentHash ?? "") &&
    Number.isSafeInteger(manifest.coordinateData?.byteLength) &&
    manifest.coordinateData.byteLength > 0 &&
    manifest.coordinateData.byteLength <= 16 * 1024 * 1024 &&
    JSON.stringify(manifest.selected?.names) === JSON.stringify(sharedRuntimeSchemaNames) &&
    /^sha256:[a-f0-9]{64}$/u.test(manifest.selected?.contentHash ?? "") &&
    Number.isSafeInteger(manifest.selected?.byteLength) &&
    manifest.selected.byteLength > 0 &&
    manifest.selected.byteLength <= 16 * 1024 * 1024 &&
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
