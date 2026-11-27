// Invariant 2 keeps provider behavior behind adapters. Applications compose provider adapters, and
// repository-knowledge-runtime is the shared composition seam that maps a run-time provider choice
// to its adapter strategy. Any other package needs a reviewed entry here before it may depend on one.
export const PROVIDER_ADAPTER_PACKAGES = new Set(["@lervo/adapter-claude", "@lervo/adapter-codex"]);

export const PROVIDER_ADAPTER_COMPOSITION_PACKAGES = new Set([
  "@lervo/repository-knowledge-runtime",
]);

/**
 * @param {Iterable<[string, { layer: "app" | "package", dependencies: string[] }]>} manifests
 * @returns {string[]}
 */
export function providerAdapterDependencyViolations(manifests) {
  const failures = [];
  for (const [name, manifest] of manifests) {
    if (manifest.layer === "app" || PROVIDER_ADAPTER_COMPOSITION_PACKAGES.has(name)) continue;
    if (PROVIDER_ADAPTER_PACKAGES.has(name)) continue;
    for (const dependency of manifest.dependencies) {
      if (PROVIDER_ADAPTER_PACKAGES.has(dependency))
        failures.push(
          `${name} must not depend on provider adapter ${dependency}; only applications and ${[...PROVIDER_ADAPTER_COMPOSITION_PACKAGES].join(", ")} compose provider adapters`,
        );
    }
  }
  return failures;
}
